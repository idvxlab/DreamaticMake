"""Sismic integration with an allowlisted Python subset and host-owned clock.

This profile executes model traces, not firmware. No wall clock or sleep is used.
Only primitive JSON context and direct event fields enter the evaluator.
"""
import ast
import json
import math
import operator
from typing import Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, NonNegative, Sha256


def validate_code(code, mode='eval'):
    if not code: return
    if len(code) > 10000: raise ValueError('Statechart code exceeds budget')
    tree = ast.parse(code, mode=mode)
    pending, count = [(tree,0)], 0
    while pending:
        node, depth = pending.pop(); count += 1
        if count > 2000 or depth > 64: raise ValueError('Statechart AST complexity exceeds budget')
        pending.extend((child,depth+1) for child in ast.iter_child_nodes(node))
    allowed = (ast.Expression, ast.Module, ast.Expr, ast.Assign, ast.Name, ast.Load, ast.Store,
        ast.Constant, ast.Attribute, ast.Call, ast.keyword, ast.BoolOp, ast.And, ast.Or,
        ast.UnaryOp, ast.Not, ast.USub, ast.UAdd, ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div,
        ast.Compare, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.IfExp)
    for node in ast.walk(tree):
        if not isinstance(node, allowed): raise ValueError('Unsupported statechart syntax: ' + type(node).__name__)
        if isinstance(node, ast.Name) and node.id.startswith('_'): raise ValueError('Private names forbidden')
        if isinstance(node, ast.Attribute) and (not isinstance(node.value, ast.Name) or node.value.id != 'event' or node.attr.startswith('_')):
            raise ValueError('Only direct event fields are allowed')
        if isinstance(node, ast.Call):
            functions = ('after', 'idle', 'active') if mode == 'eval' else ('send',)
            if not isinstance(node.func, ast.Name) or node.func.id not in functions:
                raise ValueError('Unregistered statechart call')
            if any(k.arg is None or k.arg.startswith('_') for k in node.keywords): raise ValueError('Invalid event arguments')
        if isinstance(node, ast.Assign):
            if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name): raise ValueError('Only variable assignment is allowed')
            if node.targets[0].id in ('event', 'send', 'after', 'idle', 'active', 'time'): raise ValueError('Reserved statechart variable')
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) > 1000:
            raise ValueError('String exceeds budget')
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            if not math.isfinite(node.value) or abs(node.value) > 1e100: raise ValueError('Numeric budget exceeded')


class Stimulus(Contract):
    id: str
    at_s: NonNegative
    target: str
    kind: Literal['event'] = 'event'
    payload: dict = Field(default_factory=dict)


class Assertion(Contract):
    kind: Literal['at', 'always', 'eventually']
    state: str
    at_s: NonNegative | None = None


class Scenario(Contract):
    schema_version: Literal['scenario/2.0.0-draft'] = 'scenario/2.0.0-draft'
    id: str
    design_snapshot_id: Sha256
    backend_profile: Literal['sismic/restricted-v1'] = 'sismic/restricted-v1'
    duration_s: NonNegative
    seed: int = 0
    initial: dict = Field(default_factory=dict)
    stimuli: tuple[Stimulus, ...] = ()
    wakeups_s: tuple[NonNegative, ...] = ()
    assertions: tuple[Assertion, ...] = ()
    microstep_budget: int = Field(default=1000, ge=1, le=100000)

    @model_validator(mode='after')
    def timeline(self):
        if len({e.id for e in self.stimuli}) != len(self.stimuli): raise ValueError('Event IDs must be unique')
        times = [e.at_s for e in self.stimuli] + list(self.wakeups_s) + [a.at_s for a in self.assertions if a.at_s is not None]
        if any(t > self.duration_s for t in times): raise ValueError('Scenario timestamp outside duration')
        if any(a.kind == 'at' and a.at_s is None for a in self.assertions): raise ValueError('At assertion requires timestamp')
        return self


def run_statechart(yaml_text, scenario, *, validate_only=False):
    """Stable same-time events; explicit wakeups for after guards, bounded microsteps."""
    from sismic.io import import_from_yaml
    from sismic.code import PythonEvaluator
    from sismic.clock import SimulatedClock
    from sismic.interpreter import Interpreter
    from sismic.model import Event

    def primitive(value):
        if type(value) is bool or value is None: return
        if type(value) is str and len(value) <= 1000: return
        if type(value) in (int,float) and math.isfinite(value) and abs(value) <= 1e100: return
        raise ValueError('Statechart context/event values must be finite JSON primitives')

    for v in scenario.initial.values(): primitive(v)
    for stimulus in scenario.stimuli:
        for v in stimulus.payload.values(): primitive(v)
    if len(yaml_text.encode('utf-8')) > 256_000: raise ValueError('Statechart YAML exceeds budget')
    import yaml
    depth = 0
    for event in yaml.parse(yaml_text):
        if isinstance(event, yaml.events.AliasEvent): raise ValueError('YAML aliases are not supported')
        if isinstance(event, (yaml.events.MappingStartEvent, yaml.events.SequenceStartEvent)): depth += 1
        if isinstance(event, (yaml.events.MappingEndEvent, yaml.events.SequenceEndEvent)): depth -= 1
        if depth > 32: raise ValueError('YAML nesting exceeds budget')
    chart = import_from_yaml(text=yaml_text)
    if len(chart.states) > 512 or len(chart.transitions) > 2048: raise ValueError('Statechart size exceeds budget')
    # Validate every code fragment, including unreachable states and contracts.
    validate_code(chart.preamble, 'exec')
    for name in chart.states:
        state = chart.state_for(name)
        for field in ('on_entry', 'on_exit'): validate_code(getattr(state, field, None), 'exec')
        for field in ('preconditions', 'postconditions', 'invariants'):
            for code in getattr(state, field, []): validate_code(code)
    for transition in chart.transitions:
        validate_code(transition.guard)
        validate_code(transition.action, 'exec')
        for field in ('preconditions', 'postconditions', 'invariants'):
            for code in getattr(transition, field, []): validate_code(code)

    if validate_only:
        return {'execution': 'completed', 'outcome': 'unknown', 'trace': [], 'outputs': [],
            'coverage': ['All statechart code validated against restricted-v1; no simulation executed']}
    outputs = []
    class RestrictedEvaluator(PythonEvaluator):
        def expression(self, node, extra):
            context = {**self.context, 'time': self._interpreter.time,
                'active': lambda name: name in self._interpreter.configuration, **(extra or {})}
            def visit(n):
                if isinstance(n, ast.Constant): return n.value
                if isinstance(n, ast.Name): return context[n.id]
                if isinstance(n, ast.Attribute): return getattr(context['event'], n.attr)
                if isinstance(n, ast.Call):
                    return context[n.func.id](*[visit(v) for v in n.args], **{k.arg: visit(k.value) for k in n.keywords})
                if isinstance(n, ast.IfExp): return visit(n.body if visit(n.test) else n.orelse)
                if isinstance(n, ast.BoolOp):
                    for child in n.values:
                        value = visit(child)
                        if isinstance(n.op, ast.And) and not value: return value
                        if isinstance(n.op, ast.Or) and value: return value
                    return value
                if isinstance(n, ast.UnaryOp):
                    value = visit(n.operand)
                    if isinstance(n.op, ast.Not): return not value
                    if type(value) not in (int, float): raise ValueError('Numeric operand required')
                    return -value if isinstance(n.op, ast.USub) else value
                if isinstance(n, ast.BinOp):
                    a, b = visit(n.left), visit(n.right)
                    if type(a) not in (int, float) or type(b) not in (int, float): raise ValueError('Numeric operands required')
                    result = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}[type(n.op)](a, b)
                    if not math.isfinite(result) or abs(result) > 1e100: raise ValueError('Numeric budget exceeded')
                    return result
                if isinstance(n, ast.Compare):
                    left = visit(n.left)
                    for op, right_node in zip(n.ops, n.comparators):
                        right = visit(right_node)
                        if not {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
                                ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}[type(op)](left, right): return False
                        left = right
                    return True
                raise ValueError('Unsupported expression')
            return visit(node)

        def _evaluate_code(self, code, *, additional_context=None):
            validate_code(code)
            return True if code is None else bool(self.expression(ast.parse(code, mode='eval').body, additional_context))

        def _execute_code(self, code, *, additional_context=None):
            validate_code(code, 'exec')
            from sismic.model import InternalEvent
            events = []
            def send(name, **payload):
                for v in payload.values(): primitive(v)
                if not isinstance(name, str) or len(name) > 128: raise ValueError('Invalid output event name')
                if len(outputs) >= 10000: raise ValueError('Output event budget exceeded')
                outputs.append({'sequence': len(outputs), 'at_s': self._interpreter.time, 'name': name, 'payload': payload})
                events.append(InternalEvent(name, **payload))
            extra = {**(additional_context or {}), 'send': send}
            for statement in ast.parse(code or '', mode='exec').body:
                value = self.expression(statement.value, extra)
                if isinstance(statement, ast.Assign):
                    primitive(value)
                    self._context[statement.targets[0].id] = value
            for v in self.context.values(): primitive(v)
            return events

    clock = SimulatedClock()
    interpreter = Interpreter(chart, evaluator_klass=RestrictedEvaluator, initial_context=scenario.initial, clock=clock)
    trace, steps = [], 0
    def settle(event_id=None):
        nonlocal steps
        while True:
            steps += 1
            if steps > scenario.microstep_budget: raise ValueError('Statechart microstep budget exceeded / nonconvergent model')
            if interpreter.execute_once() is None: break
        trace.append({'at_s': clock.time, 'event_id': event_id, 'states': list(interpreter.configuration),
                      'context': dict(interpreter.context)})
    settle()
    times = sorted({0., scenario.duration_s, *scenario.wakeups_s,
                    *(s.at_s for s in scenario.stimuli), *(a.at_s for a in scenario.assertions if a.at_s is not None)})
    for time in times:
        clock.time = time
        for stimulus in scenario.stimuli:
            if stimulus.at_s == time:
                interpreter.queue(Event(stimulus.target, **stimulus.payload))
                settle(stimulus.id)
        settle()
    failures = []
    for assertion in scenario.assertions:
        frames = [f for f in trace if assertion.at_s is None or f['at_s'] == assertion.at_s]
        values = [assertion.state in f['states'] for f in frames]
        passed = bool(values) and (any(values) if assertion.kind == 'eventually' else (values[-1] if assertion.kind == 'at' else all(values)))
        if not passed: failures.append(assertion.model_dump(mode='json'))
    return {'execution': 'completed', 'outcome': 'fail' if failures else ('pass' if scenario.assertions else 'unknown'),
            'trace': trace, 'outputs': outputs, 'failures': failures, 'coverage': ['Sismic state/event trace at explicit host timestamps; not MCU execution']}
