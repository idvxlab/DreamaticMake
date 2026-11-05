"""Prepare housing information or integrate explicitly authored CAD housing objects."""
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id, Sha256
from element.base.frame import Pose
from element.categories.housing import CADHousing, HousingMaterial
from element.schema.library import ElementDefinition, ElementRef
from element.io.records import element_ref
from engine.design.contracts import ObjectRef, SelectionData, Candidate, DiscreteUsage, Instance
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.proposal import updated_record


class MechanicalDetailInput(Contract):
    action: Literal['prepare_conditions', 'generate_parts', 'integrate_parts']
    subject_instance_refs: tuple[ObjectRef, ...] = ()
    material: HousingMaterial | None = None
    housing: CADHousing | None = None
    pose: Pose | None = None
    library_id: Id = 'custom'
    selection_record_id: Id = 'housing_selection'
    instance_id: Id = 'housing'


class HousingSubject(Contract):
    instance_ref: ObjectRef
    element_ref: ElementRef
    placed: bool
    geometry_available: bool


class MechanicalDetailOutput(Contract):
    source_snapshot_id: Sha256
    subjects: tuple[HousingSubject, ...] = ()
    material: HousingMaterial
    element_ref: ElementRef | None = None
    instance_ref: ObjectRef | None = None
    limitations: tuple[str, ...] = ('No fit, strength, manufacturing or physical acceptance was executed.',)


class MechanicalDetailRequest(ProcessRequest[MechanicalDetailInput]):
    process_kind: Literal['mechanical_detail'] = 'mechanical_detail'


MechanicalDetailResult = ProcessResult[MechanicalDetailOutput]


class MechanicalDetailProcess(DesignProcess[MechanicalDetailRequest, MechanicalDetailResult]):
    kind, title = 'mechanical_detail', '外壳与机械连接深化'
    actions = ('prepare_conditions', 'generate_parts', 'integrate_parts')
    request_model, result_model, output_model = MechanicalDetailRequest, MechanicalDetailResult, MechanicalDetailOutput

    def _inspect(self, r, ctx, resolved):
        x, items = r.input, []
        if x.action == 'generate_parts':
            return [need('cad_executor', 'No Python CAD generation backend is registered; browser JSCAD remains available', 'executor', 'unsupported')]
        if x.material is None and x.housing is None:
            items.append(need('material', 'Specify material; physical properties may remain explicitly unknown'))
        if x.material and x.housing and x.material != x.housing.cad_housing.material:
            items.append(need('material', 'Condition material conflicts with housing material', state='conflict'))
        for ref in x.subject_instance_refs:
            if ref.key() not in resolved.instance_elements:
                items.append(need('subjects', 'Subject instance is unavailable', 'design', refs=(ref,)))
        if x.action == 'integrate_parts':
            if x.housing is None:
                items.append(need('housing', 'Provide an authored CADHousing with geometry and material', 'element'))
            if x.pose is None:
                items.append(need('pose', 'Provide an explicit housing world pose'))
            if x.selection_record_id not in r.scope.write_record_ids:
                items.append(need('scope', 'Housing selection is outside write scope', state='conflict'))
            if any(v.record_id == x.selection_record_id for v in r.base.design.records):
                items.append(need('selection_record_id', 'Integration creates a new selection; choose an unused record ID', 'design', 'conflict'))
        return items

    def _run(self, r, ctx):
        x, resolved = r.input, ctx.resolve(r.base.design)
        subjects = tuple(HousingSubject(instance_ref=ref,
            element_ref=element_ref(resolved.instance_elements[ref.key()]),
            placed=resolved.objects[ref.key()].pose is not None,
            geometry_available=bool(resolved.instance_elements[ref.key()].model.geometry.envelopes
                or resolved.instance_elements[ref.key()].model.geometry.visual_assets)) for ref in x.subject_instance_refs)
        material = x.housing.cad_housing.material if x.housing else x.material
        if x.action == 'prepare_conditions':
            return self.finish(r, ctx, MechanicalDetailOutput(source_snapshot_id=r.base.snapshot_id,
                subjects=subjects, material=material))
        definition = ElementDefinition(library_id=x.library_id, element_id=x.housing.id,
            revision=x.housing.revision, name=x.housing.name, category='structure',
            subtype='cad_housing', origin='custom', model=x.housing)
        pin = element_ref(definition)
        data = SelectionData(candidates={'chosen': Candidate(element_ref=pin)}, chosen_candidate_id='chosen',
            usage=DiscreteUsage(planned_count=1, instances={x.instance_id: Instance(label=x.housing.name, pose=x.pose)}))
        ref = ObjectRef(record_id=x.selection_record_id, collection='instances', object_id=x.instance_id)
        return self.finish(r, ctx, MechanicalDetailOutput(source_snapshot_id=r.base.snapshot_id,
            subjects=subjects, material=material, element_ref=pin, instance_ref=ref),
            changes=(updated_record(r.base.design, x.selection_record_id, 'selection', data),), elements=(definition,))
