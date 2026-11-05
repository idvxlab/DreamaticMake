"""Evidence-preserving discovery over native libraries and incomplete source records."""
import re
import json
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import get_args
from element.base.quantity import Quantity
from element.io.records import element_ref, record_hash
from element.io.save import canonical_json
from element.schema.library import Category, ElementQuery
from element.schema.retrieval import (ParameterFact, ParameterRequirement, RetrievalQuery,
    RetrievalRef, RetrievalPlan, RetrievalCandidate, ParameterAssessment, RetrievalResult)
from element.library.local import normalize, tokens, LibraryError

# Specific product/function terms are independent of the fourteen primary categories.
VOCABULARY = (
    ('actuator', ('舵机', '伺服', 'servo', 'sg90')),
    ('actuator', ('直流电机', '有刷电机', 'dc motor', '130电机')),
    ('actuator', ('电机', '马达', 'motor', 'actuator', '执行器')),
    ('controller', ('控制器', '开发板', '单片机', '主控', 'controller', 'arduino', 'uno')),
    ('sensor', ('温度', '测温', 'temperature', 'tmp36')),
    ('sensor', ('光照', '环境光', '光电三极管', 'phototransistor')),
    ('sensor', ('倾斜', '倾角', 'tilt')),
    ('sensor', ('传感器', 'sensor')),
    ('light', ('红色led', '红色 led', '红灯', 'red led')),
    ('light', ('rgb', '彩色灯', '三色灯')),
    ('light', ('发光', '指示灯', 'led', '灯', 'light')),
    ('display', ('显示屏', '液晶', '显示器', 'lcd', '1602', 'display')),
    ('sound', ('蜂鸣器', '压电', 'buzzer', 'piezo', 'sound')),
    ('human_input', ('按键', '按钮', 'pushbutton', 'button')),
    ('human_input', ('电位器', 'potentiometer')),
    ('human_input', ('人机输入', 'human_input')),
    ('driver', ('驱动器', 'h桥', 'h 桥', 'l293d', 'driver')),
    ('power', ('电池', 'battery')),
    ('power', ('电源', '供电模块', 'power')),
    ('structure', ('面包板', 'breadboard')),
    ('structure', ('结构件', '外壳', 'structure', 'housing')),
    ('circuit_element', ('电阻', 'resistor')),
    ('circuit_element', ('电容', 'capacitor')),
    ('circuit_element', ('光耦', 'optocoupler', '4n35')),
    ('circuit_element', ('mosfet', '场效应管', 'irf520')),
    ('circuit_element', ('二极管', 'diode', '1n4007')),
    ('circuit_element', ('排针', 'pin header')),
    ('transmission', ('传动', '齿轮', 'transmission')),
    ('transport', ('输送', 'transport')),
    ('energy_storage', ('储能', '弹簧', 'energy_storage')),
)

# Aliases deliberately preserve rating semantics. There is no generic "current -> any current" mapping.
PARAMETER_ALIASES = {
    'continuous_torque': ('持续扭矩', '额定扭矩', '连续扭矩'),
    'no_load_speed': ('空载转速', '空载速度'), 'no_load_current': ('空载电流',),
    'stall_current': ('堵转电流',), 'mass': ('质量', '重量'),
    'shaft_diameter': ('轴径', '轴直径'), 'rated_power': ('额定功率',),
    'resistance': ('阻值', '电阻值'), 'capacitance': ('电容量', '电容值'),
    'cpu_clock': ('主频', '时钟频率'), 'pin_pitch': ('针距', '间距'),
    'supply_voltage': ('供电电压', '工作电压', '供电'),
    'temperature_range': ('测温范围', '温度范围'),
}
UNIT_ALIASES = {'伏': 'V', '伏特': 'V', '安': 'A', '毫安': 'mA', '克': 'g', '千克': 'kg',
    '毫米': 'mm', '厘米': 'cm', '欧姆': 'ohm', '欧': 'ohm', 'Ω': 'ohm', 'ω': 'ohm',
    'μf': 'uF', 'µf': 'uF', 'uf': 'uF', 'kω': 'kohm', 'kΩ': 'kohm',
    '℃': 'degC', '°c': 'degC', '摄氏度': 'degC', 'mhz': 'Hz', 'khz': 'Hz',
    'v': 'V', 'mv': 'mV', 'a': 'A', 'ma': 'mA', 'w': 'W', 'hz': 'Hz', 'n*m': 'N*m'}
NUMERIC = re.compile(r'(?P<value>-?\d+(?:\.\d+)?)\s*(?P<unit>kg|g|mm|cm|mA|mV|MHz|kHz|Hz|rpm|N\*m|kohm|ohm|uF|µF|μF|kΩ|Ω|V|A|W|℃|°C|degC|毫安|千克|毫米|厘米|摄氏度|伏特|伏|克|欧姆)(?![A-Za-z])', re.I)
RANGE = re.compile(r'(?P<low>-?\d+(?:\.\d+)?)\s*(?P<low_unit>V|℃|°C|degC|rpm|mm|cm|g|kg)?\s*(?:到|至|~|～|–|—|-)\s*' + NUMERIC.pattern, re.I)
PARAMETER_DIMENSIONS = {'supply_voltage': 'voltage', 'mass': 'mass', 'resistance': 'resistance',
    'capacitance': 'capacitance', 'continuous_torque': 'torque', 'no_load_speed': 'angular_speed',
    'no_load_current': 'current', 'stall_current': 'current', 'shaft_diameter': 'length',
    'rated_power': 'power', 'cpu_clock': 'frequency', 'pin_pitch': 'length', 'temperature_range': 'temperature'}


def _parse_plan(query):
    text = normalize(query.text)
    inferred, groups, matched = [], [], []
    for category, aliases in VOCABULARY:
        found = [a for a in aliases if normalize(a) in text]
        if found:
            inferred.append(category)
            # Prefer a specific phrase over an overlapping generic phrase.
            if not any(all(normalize(a) in normalize(b) for a in found) for b in matched):
                groups.append(aliases)
            matched.extend(found)
    requirements = list(query.requirements)
    warnings = []
    consumed = []
    ranges = list(RANGE.finditer(query.text))
    matches = sorted([*ranges, *(m for m in NUMERIC.finditer(query.text)
        if not any(a.start() <= m.start() < a.end() for a in ranges))], key=lambda m: m.start())
    for match in matches:
        if re.match(r'[·*/]', query.text[match.end():]):
            warnings.append('Unsupported compound unit: ' + match.group() + '; use a supported Quantity unit.')
            continue
        raw_unit = match['unit']
        unit = UNIT_ALIASES.get(raw_unit, UNIT_ALIASES.get(raw_unit.casefold(), raw_unit))
        value = float(match['value']) * (1e6 if raw_unit.casefold() == 'mhz' else 1e3 if raw_unit.casefold() == 'khz' else 1)
        q = Quantity(value=value, unit=unit)
        before = re.split(r'[，,;；。]', normalize(query.text[max(0, match.start()-32):match.start()]))[-1]
        # The closest explicit parameter name wins; otherwise only unambiguous dimensions are inferred.
        names = [(before.rfind(alias), code) for code, aliases in PARAMETER_ALIASES.items()
                 for alias in (code, *aliases) if alias in before and PARAMETER_DIMENSIONS.get(code) == q.dimension]
        code = max(names)[1] if names else {'voltage': 'supply_voltage', 'mass': 'mass',
            'resistance': 'resistance', 'capacitance': 'capacitance', 'temperature': 'temperature_range'}.get(q.dimension)
        if code is None:
            warnings.append('Unmapped numeric phrase: ' + match.group() + '; supply an explicit parameter_code.')
            continue
        after = normalize(query.text[match.end():match.end()+5])
        lower = bool(re.search(r'(至少|不低于|不少于|大于等于|>=|≥|at least|minimum)\s*$', before)) or after.startswith(('以上', '及以上'))
        upper = bool(re.search(r'(不超过|不高于|最多|小于等于|<=|≤|at most|maximum)\s*$', before)) or after.startswith(('以下', '以内', '及以下'))
        # Strict inequalities and ranges are left for LLM refinement rather than silently relaxed.
        if re.search(r'(大于|小于|超过|低于|>|<|约|大约)\s*$', before) and not (lower or upper):
            warnings.append('Ambiguous/strict numeric phrase: ' + match.group() + '; use explicit inclusive bounds.')
            continue
        if not any(r.parameter_code == code for r in query.requirements):
            requirements.append(ParameterRequirement(parameter_code=code,
                minimum=Quantity(value=float(match['low']), unit=UNIT_ALIASES.get((match['low_unit'] or unit).casefold(), match['low_unit'] or unit))
                    if 'low' in match.groupdict() else None if upper else q,
                maximum=None if lower else q))
        consumed.append(match.span())
    # Unparsed numbers/units and qualitative wishes remain explicit context, never verification.
    residual = query.text
    for start, end in reversed(consumed): residual = residual[:start] + ' ' * (end-start) + residual[end:]
    if re.search(r'\d', residual):
        warnings.append('Some numbers may be model names or unparsed constraints; inspect the plan before selection.')
    if query.text.strip():
        warnings.append('Free text is discovery context; unparsed wishes are not enforced. Refine with structured requirements.')
    terms = tuple(dict.fromkeys((*matched, *re.findall(r'[a-z][a-z0-9_.-]*', text))))
    plan = RetrievalPlan(text=query.text, categories=query.categories or tuple(dict.fromkeys(inferred)),
        category_source='explicit' if query.categories else 'inferred' if inferred else 'none',
        terms=terms, requirements=tuple(requirements), warnings=tuple(dict.fromkeys(warnings)))
    return plan, groups


@dataclass(frozen=True)
class SearchRecord:
    ref: RetrievalRef
    name: str
    category: str
    search_text: str
    parameters: dict[str, ParameterFact]
    blockers: tuple[str, ...]
    native_ref: object = None
    definition: object = None
    detail: dict | None = None


def native_facts(definition):
    facts = {}
    for code, parameter in definition.model.parameters.items():
        evidence = {key: definition.model.evidence[key].model_dump(mode='json')
            for key in parameter.evidence_refs if key in definition.model.evidence}
        source_ids = {e.get('source_ref') for e in evidence.values()}
        sources = {key: value.model_dump(mode='json') for key, value in definition.model.sources.items() if key in source_ids}
        facts[code] = ParameterFact(code=code, status=parameter.status, value=parameter.value,
            minimum=parameter.range.min if parameter.range else None, maximum=parameter.range.max if parameter.range else None,
            conditions=parameter.conditions, evidence=evidence, sources=sources,
            evidence_supported=bool(evidence) and len(evidence) == len(parameter.evidence_refs) and
                all(e['kind'] != 'assumed' for e in evidence.values()))
    for code, parameter in definition.parameters.items():
        evidence = {key: definition.evidence[key].model_dump(mode='json') for key in parameter.evidence_ids}
        sources = {sid: definition.sources[sid].model_dump(mode='json') for e in evidence.values() for sid in e['source_ids']}
        facts[code] = ParameterFact(code=code, status='known' if parameter.value or parameter.limits else 'unknown',
            value=parameter.value, minimum=parameter.limits.min if parameter.limits else None,
            maximum=parameter.limits.max if parameter.limits else None, evidence=evidence, sources=sources,
            evidence_supported=bool(evidence) and all(e['basis'] != 'assumption' for e in evidence.values()))
    return facts


def native_record(definition, *, blockers=(), detail=None):
    pin = element_ref(definition)
    return SearchRecord(ref=RetrievalRef(library_id=pin.library_id, element_id=pin.element_id,
        revision=pin.revision, content_hash=record_hash({'definition': definition.model_dump(mode='json'), 'detail': detail}, 'search-record-v1')),
        name=definition.name, category=definition.category,
        search_text=normalize(' '.join((definition.name, *definition.aliases, definition.product.model or '',
            definition.category, *definition.tags, *definition.roles, *definition.capabilities.keys()))),
        parameters=native_facts(definition), blockers=tuple(blockers), native_ref=pin,
        definition=definition, detail=detail)


def _assess(requirement, facts):
    code = requirement.parameter_code
    # Only explicit, semantically equivalent aliases are allowed. Never use absolute maxima as ratings.
    alternatives = {'resistance': ('resistance', 'resistance_selected'),
        'continuous_torque': ('continuous_torque', 'continuous_rated_torque')}
    selected = next(((c, facts[c]) for c in alternatives.get(code, (code,)) if c in facts), None)
    range_pairs = {'supply_voltage': (('recommended_supply_min', 'recommended_supply_max'),
        ('supply_min', 'supply_max'), ('logic_supply_min', 'logic_supply_max')),
        'temperature_range': (('temperature_min', 'temperature_max'),)}
    pair = next(((a, b) for a, b in range_pairs.get(code, ()) if a in facts and b in facts), None)
    chosen = tuple(facts[c] for c in pair) if pair else (selected[1],) if selected else ()
    outcome, reason = 'unknown', 'Parameter is missing, unknown, assumed, unsupported or lacks evidence.'
    if chosen and all(f.status == 'known' and f.evidence_supported for f in chosen):
        low = chosen[0].value or chosen[0].minimum
        high = (chosen[1].value or chosen[1].maximum) if pair else chosen[0].maximum or chosen[0].value
        target = requirement.minimum or requirement.maximum
        if low and high and low.dimension == high.dimension == target.dimension and low.si_value <= high.si_value:
            if pair:
                # Operating capability ranges must contain the requested operating domain.
                match = (requirement.minimum is None or low.si_value <= requirement.minimum.si_value <= high.si_value) and (
                    requirement.maximum is None or low.si_value <= requirement.maximum.si_value <= high.si_value)
            else:
                # A published range must wholly satisfy a bound, not merely overlap it.
                match = (requirement.minimum is None or low.si_value >= requirement.minimum.si_value) and (
                    requirement.maximum is None or high.si_value <= requirement.maximum.si_value)
            outcome = 'match' if match else 'mismatch'
            reason = 'Compared evidence-backed values in SI; source conditions still require review.'
        else:
            reason = 'Missing compatible bounds or incompatible dimensions; no numeric match inferred.'
    return ParameterAssessment(requirement=requirement, outcome=outcome, facts=chosen,
        parameter_codes=tuple(f.code for f in chosen), explanation=reason)


class ElementRetriever:
    """In-memory immutable discovery snapshot. No files, models or agent code are executed."""
    def __init__(self, records, *, diagnostics=()):
        # Copy caller-owned containers; facts/definitions are already immutable contracts.
        self.records = tuple(replace(r, parameters=MappingProxyType(dict(r.parameters)),
            detail=json.loads(canonical_json(r.detail)) if r.detail else None) for r in records)
        keys = [(r.ref.library_id, r.ref.element_id) for r in self.records]
        if len(keys) != len(set(keys)):
            raise ValueError('Retrieval snapshot requires unique element identities')
        self.diagnostics = tuple(diagnostics)
        self.generation = record_hash([r.ref.model_dump(mode='json') for r in sorted(self.records,
            key=lambda r: (r.ref.library_id, r.ref.element_id))], 'retrieval-snapshot-v1')

    @classmethod
    def from_library(cls, library):
        records, cursor = [], None
        while True:
            page = library.search(ElementQuery(limit=100, cursor=cursor))
            records.extend(native_record(library.get(hit['ref'])) for hit in page['items'])
            cursor = page['next_cursor']
            if not cursor: break
        return cls(records)

    def describe(self):
        return {'schema_version': '0.1.0-draft', 'index_generation': self.generation,
            'query_schema': RetrievalQuery.model_json_schema(), 'diagnostics': list(self.diagnostics),
            'categories': [{'category': category, 'count': sum(r.category == category for r in self.records),
                'selectable_count': sum(r.category == category and r.native_ref is not None for r in self.records),
                'aliases': sorted({a for c, aliases in VOCABULARY if c == category for a in aliases}),
                'parameter_codes': sorted({p for r in self.records if r.category == category for p in r.parameters})}
                for category in get_args(Category)], 'parameter_aliases': PARAMETER_ALIASES}

    def get(self, ref):
        ref = RetrievalRef.model_validate_json(canonical_json(ref))
        record = next((r for r in self.records if r.ref == ref), None)
        if record is None: raise LibraryError('not_found', 'Search record pin is unavailable or stale')
        return {'ref': ref.model_dump(mode='json'), 'name': record.name, 'category': record.category,
            'native_ref': record.native_ref.model_dump(mode='json') if record.native_ref else None,
            'selectable': record.native_ref is not None, 'blockers': list(record.blockers),
            'parameters': {code: fact.model_dump(mode='json') for code, fact in record.parameters.items()},
            'definition': record.definition.model_dump(mode='json') if record.definition else None,
            'source_detail': json.loads(canonical_json(record.detail)) if record.detail else None}

    def search(self, query):
        query = RetrievalQuery.model_validate_json(canonical_json(query))
        if query.expected_generation and query.expected_generation != self.generation:
            raise LibraryError('index_changed', 'Retrieval snapshot changed; restart search')
        plan, groups = _parse_plan(query)
        candidates = []
        for record in self.records:
            if plan.categories and record.category not in plan.categories: continue
            if not query.include_incomplete and record.native_ref is None: continue
            relevant = [aliases for aliases in groups if any(c == record.category and aliases == a for c, a in VOCABULARY)]
            # A specific concept must match a name/model alias; generic category words alone are broad.
            specific = [aliases for aliases in relevant if not any(a in ('actuator', '执行器', 'motor', 'controller',
                'sensor', 'light', 'power', 'structure', 'human_input') for a in aliases)]
            if specific and not all(any(normalize(a) in record.search_text for a in aliases) for aliases in specific): continue
            matched = tuple(term for term in plan.terms if normalize(term) in record.search_text)
            if query.text.strip() and not plan.categories and not matched and not (set(tokens(query.text)) & set(tokens(record.search_text))): continue
            assessments = tuple(_assess(r, record.parameters) for r in plan.requirements)
            rejected = any(a.outcome == 'mismatch' and a.requirement.hard for a in assessments)
            if rejected and not query.include_mismatches: continue
            unknown = tuple(a.requirement.parameter_code for a in assessments if a.outcome == 'unknown')
            state = 'rejected' if rejected else 'needs_review' if unknown or record.native_ref is None or plan.warnings or any(
                a.outcome == 'mismatch' for a in assessments) else 'eligible'
            weight = sum(a.requirement.weight for a in assessments)
            numeric_score = sum(a.requirement.weight for a in assessments if a.outcome == 'match') / weight if weight else 0
            score = float(round(20 * len(matched) + 100 * numeric_score - 100 * rejected, 6))
            candidates.append(RetrievalCandidate(ref=record.ref, native_ref=record.native_ref,
                name=record.name, category=record.category, selectable=record.native_ref is not None,
                blockers=record.blockers, score=score, matched_terms=matched, assessments=assessments,
                missing_parameters=unknown, selection_state=state))
        candidates.sort(key=lambda c: (c.selection_state == 'rejected', -c.score, not c.selectable,
            c.ref.library_id, c.ref.element_id))
        page = candidates[query.offset:query.offset+query.limit]
        return RetrievalResult(plan=plan, items=tuple(page), total=len(candidates),
            next_offset=query.offset+len(page) if query.offset+len(page) < len(candidates) else None,
            index_generation=self.generation)
