from element.io.package import template_path, template_paths, scenario_path
import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from pydantic import ValidationError
from element.categories import CADHousing, CADHousingSpec, HousingMaterial, Structure, Controller
from element.interfaces.geometry import Box
from element.interfaces.mechanical import MechanicalSpec, MechanicalPort
from element.interfaces.electrical import ElectricalSpec, Terminal
from element.base.frame import Pose
from element.base.quantity import Parameter, Quantity
from element.schema.library import ElementDefinition, ElementQuery, ElementParameter, Source, Evidence
from element.library import ElementLibrary
from element.io.records import element_ref, parse_element
from element.io.components import load_component
from element.io.save import canonical_json
from engine.design import make_package, resolve_design, project_design, snapshot_id, DesignStore
from engine.design.contracts import (DiscreteUsage, Instance, ObjectRef, StructureConnection,
    Net, Joint, Drive, LogicData, CodeUnit, LogicPort, BooleanType, LogicBinding, Requirement)
from engine.design.bom import derive_bom
from engine.compiler.lower import compile_model
from process import *
from process.registry import PROCESSES, get_process


def fixture(id='part'):
    model = Structure.from_shape(id=id, name=id, shape=Box(size_m=(0.02, 0.02, 0.02)),
        mounts=MechanicalSpec(ports={'mount': MechanicalPort(body_ref='body', kind='plane')}))
    return ElementDefinition(library_id='test', element_id=id, name=id, category='structure', model=model)


def empty():
    return make_package(design_id='demo', title='Demo')


def select(package, definition, record='parts', names=('a', 'b')):
    package = make_package(design_id=package.manifest.design_id, title=package.manifest.title,
        revision=package.manifest.revision, records=package.records, elements=(*package.elements, definition))
    request = SelectionRequest.for_design(package, input=SelectionInput(action='choose',
        selection_record_id=record, chosen_ref=element_ref(definition),
        usage=DiscreteUsage(planned_count=len(names), instances={n: Instance(label=n) for n in names})),
        write_record_ids=(record,))
    result = SelectionProcess().run(request)
    assert result.status == 'completed', result
    return build_candidate(package, result.proposals[0], write_record_ids=(record,))


class ProcessTests(unittest.TestCase):
    def test_housing_roundtrip_material_hash_and_engine(self):
        material = HousingMaterial(name='PETG', density=Parameter(status='assumed',
            value=Quantity(value=1270.0, unit='kg/m3')))
        housing = CADHousing.from_shape(id='shell', name='Shell', shape=Box(size_m=(0.08, 0.06, 0.03)),
            cad_housing=CADHousingSpec(material=material))
        definition = ElementDefinition(library_id='custom', element_id='shell', name='Shell',
            category='structure', origin='custom', model=housing)
        restored = parse_element(definition)
        self.assertEqual(restored.model.cad_housing.material, material)
        self.assertEqual(element_ref(definition), element_ref(restored))
        altered = housing.replace(cad_housing=CADHousingSpec(material=HousingMaterial(name='ABS')))
        changed = ElementDefinition(library_id='custom', element_id='shell', name='Shell', category='structure', model=altered)
        self.assertNotEqual(element_ref(definition).content_hash, element_ref(changed).content_hash)
        self.assertTrue(compile_model(housing).snapshot_id)
        with self.assertRaises(ValidationError):
            HousingMaterial(name='bad', density=Parameter(status='assumed', value=Quantity(value=2.0, unit='m')))
        with self.assertRaises(ValidationError):
            CADHousing(id='empty', name='Empty', cad_housing=CADHousingSpec(material=material))
        self.assertNotIn('cad_housing', fixture().model.model_dump(mode='json'))

    def test_selection_placement_connections_motion_and_cas(self):
        package = select(empty(), fixture())
        original = canonical_json(package)
        refs = tuple(ObjectRef(record_id='parts', collection='instances', object_id=n) for n in ('a', 'b'))
        request = PlacementRequest.for_design(package, input=PlacementInput(poses=(
            PlacementTarget(instance_ref=refs[0], pose=Pose()),
            PlacementTarget(instance_ref=refs[1], pose=Pose(translation_m=(0.1, 0.0, 0.0))),
        )), write_record_ids=('parts',))
        result = PlacementProcess().run(request)
        self.assertEqual(result.status, 'completed')
        placed = build_candidate(package, result.proposals[0], write_record_ids=('parts',))
        self.assertEqual(canonical_json(package), original)
        self.assertEqual(len(placed.elements), 1)
        resolved = resolve_design(placed)
        mounts = [resolved.occurrence_ref(ref, 'mounts', 'mount') for ref in refs]
        connected_request = ConnectionRequest.for_design(placed, input=ConnectionInput(mechanical={
            'fixed': StructureConnection(a=mounts[0], b=mounts[1], kind='fixed')}), write_record_ids=('structure',))
        connected = ConnectionProcess().run(connected_request)
        self.assertEqual(connected.status, 'completed')
        candidate = build_candidate(placed, connected.proposals[0], write_record_ids=('structure',))
        self.assertFalse([d for d in resolve_design(candidate).diagnostics if d.severity == 'error'])
        self.assertEqual(connected.checks[0].subject_snapshot_id, snapshot_id(candidate.manifest))
        self.assertNotEqual(connected.checks[0].subject_snapshot_id, snapshot_id(placed.manifest))
        bodies = [resolved.occurrence_ref(ref, 'bodies', 'body') for ref in refs]
        mr = MotionRequest.for_design(placed, input=MotionInput(joints={'hinge': Joint(
            parent_body=bodies[0], child_body=bodies[1], kind='revolute', axis=(0.0, 0.0, 1.0),
            lower=Quantity(value=0.0, unit='deg'), upper=Quantity(value=90.0, unit='deg'),
            initial=Quantity(value=30.0, unit='deg'))}, drives={'drive': Drive(
                joint_ref=ObjectRef(record_id='motion', collection='joints', object_id='hinge'), mode='position',
                command=Quantity(value=30.0, unit='deg'))}), write_record_ids=('motion',))
        motion = MotionProcess().run(mr)
        self.assertEqual(motion.status, 'completed')
        moved = build_candidate(placed, motion.proposals[0], write_record_ids=('motion',))
        self.assertFalse([d for d in resolve_design(moved).diagnostics if d.severity == 'error'])
        self.assertTrue(project_design(moved)['scene']['bodies'])
        with self.assertRaises(ValueError):
            build_candidate(candidate, connected.proposals[0], write_record_ids=('structure',))
        with self.assertRaises(ValueError):
            build_candidate(placed, connected.proposals[0], write_record_ids=())
        with tempfile.TemporaryDirectory() as temp:
            store = DesignStore(Path(temp) / 'design.sqlite3')
            # Demonstrate a host-owned initial commit independently of process.run().
            initial = empty()
            store.commit(initial, expected_manifest_revision=0)
            sr = SelectionRequest.for_design(initial, input=SelectionInput(action='choose',
                chosen_ref=element_ref(fixture()), usage=DiscreteUsage(planned_count=1, instances={'one': Instance(label='One')})),
                write_record_ids=('selection',))
            library = ElementLibrary(Path(temp) / 'elements')
            library.publish(fixture())
            selected = SelectionProcess().run(sr, ProcessContext(elements=library))
            next_package = build_candidate(initial, selected.proposals[0], write_record_ids=('selection',))
            store.commit(next_package, expected_manifest_revision=1)
            self.assertEqual(snapshot_id(store.read('demo').manifest), snapshot_id(next_package.manifest))
            with self.assertRaises(ValueError):
                store.commit(next_package, expected_manifest_revision=1)

    def test_housing_integration_and_unknown_backend(self):
        material = HousingMaterial(name='PETG')
        housing = CADHousing.from_shape(id='shell', name='Shell', shape=Box(size_m=(0.08, 0.06, 0.03)),
            cad_housing=CADHousingSpec(material=material))
        r = MechanicalDetailRequest.for_design(empty(), input=MechanicalDetailInput(
            action='integrate_parts', housing=housing, pose=Pose()), write_record_ids=('housing_selection',))
        result = MechanicalDetailProcess().run(r)
        self.assertEqual(result.status, 'completed')
        candidate = build_candidate(r.base.design, result.proposals[0], write_record_ids=r.scope.write_record_ids)
        resolved = resolve_design(candidate)
        self.assertFalse([d for d in resolved.diagnostics if d.severity == 'error'])
        self.assertEqual(len(derive_bom(candidate)['items']), 1)
        self.assertEqual(candidate.elements[0].model.cad_housing.material, material)
        unsupported = MechanicalDetailRequest.for_design(candidate, input=MechanicalDetailInput(action='generate_parts'))
        result = MechanicalDetailProcess().run(unsupported)
        self.assertEqual(result.status, 'unsupported')
        self.assertFalse(result.proposals)

    def test_wiring_and_logic_authoring_do_not_execute(self):
        model = Controller(id='controller', name='Controller', platform='generic', wiring=ElectricalSpec(terminals={
            'io': Terminal(physical_pin_number='1', electrical_role='bidirectional')}))
        definition = ElementDefinition(library_id='test', element_id=model.id, name=model.name, category='controller', model=model)
        package = select(empty(), definition)
        resolved = resolve_design(package)
        terminals = tuple(resolved.occurrence_ref(ObjectRef(record_id='parts', collection='instances', object_id=n),
            'terminals', 'io') for n in ('a', 'b'))
        request = CircuitDetailRequest.for_design(package, input=CircuitDetailInput(nets={'signal': Net(
            kind='signal', members=terminals)}), write_record_ids=('circuit',))
        result = CircuitDetailProcess().run(request)
        self.assertEqual(result.status, 'completed')
        candidate = build_candidate(package, result.proposals[0], write_record_ids=('circuit',))
        self.assertFalse([d for d in resolve_design(candidate).diagnostics if d.severity == 'error'])
        logic = LogicData(units={'code': CodeUnit(name='Code', source="raise RuntimeError('must remain inert')")},
            execution_order=('code',))
        lr = LogicDetailRequest.for_design(candidate, input=LogicDetailInput(data=logic), write_record_ids=('logic',))
        authored = LogicDetailProcess().run(lr)
        self.assertEqual(authored.status, 'completed')
        self.assertFalse(authored.output.limitations == ())
        build = LogicDetailRequest.for_design(candidate, input=LogicDetailInput(action='build', data=logic))
        self.assertEqual(LogicDetailProcess().run(build).status, 'unsupported')

    def test_cli_schemas_contracts_and_dependency_direction(self):
        self.assertEqual(len(PROCESSES), 18)
        for kind in PROCESSES:
            descriptor = get_process(kind).describe()
            self.assertEqual(descriptor.input_schema['properties']['process_kind']['const'], kind)
        wrong = PlacementRequest.for_design(empty(), input=PlacementInput())
        with self.assertRaises(ValidationError):
            SelectionProcess().run(wrong)
        request = PlacementRequest.for_design(empty(), input=PlacementInput(mode='suggest_layout'))
        completed = subprocess.run([sys.executable, '-B', '-m', 'process', 'request'],
            input=request.model_dump_json(), text=True, capture_output=True, timeout=20)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(json.loads(completed.stdout)['status'], 'unsupported')
        malformed = subprocess.run([sys.executable, '-B', '-m', 'process', 'request'],
            input='{"process_kind": []}', text=True, capture_output=True, timeout=20)
        self.assertEqual(malformed.returncode, 2)
        self.assertEqual(json.loads(malformed.stdout)['type'], 'error')
        listed = subprocess.run([sys.executable, '-B', '-m', 'process', 'list'],
            capture_output=True, timeout=20)
        self.assertEqual(json.loads(listed.stdout)[0]['title'], '需求与功能文档')
        for folder in ('element', 'engine'):
            for path in Path(folder).rglob('*.py'):
                tree = ast.parse(path.read_text(encoding='utf-8-sig'))
                for node in ast.walk(tree):
                    if isinstance(node, ast.ImportFrom):
                        self.assertFalse((node.module or '').split('.')[0] == 'process', str(path))
                    elif isinstance(node, ast.Import):
                        self.assertFalse(any(n.name.split('.')[0] == 'process' for n in node.names), str(path))

    def test_missing_inputs_scope_staleness_and_cancellation(self):
        package = select(empty(), fixture())
        ref = ObjectRef(record_id='parts', collection='instances', object_id='a')
        target = PlacementTarget(instance_ref=ref, pose=Pose())
        denied = PlacementRequest.for_design(package, input=PlacementInput(poses=(target,)))
        self.assertEqual(PlacementProcess().run(denied).status, 'needs_input')
        allowed = PlacementRequest.for_design(package, input=PlacementInput(poses=(target,)), write_record_ids=('parts',))
        raw = allowed.model_dump(mode='json')
        raw['base']['snapshot_id'] = '0' * 64
        stale = PlacementProcess().run(raw)
        self.assertEqual(stale.status, 'needs_input')
        self.assertEqual(stale.missing_inputs[0].state, 'conflict')
        cancelled = PlacementProcess().run(allowed, ProcessContext(cancelled=lambda: True))
        self.assertFalse(cancelled.proposals)
        locked = PlacementRequest.for_design(package, input=PlacementInput(poses=(target,), fixed_instance_refs=(ref,)), write_record_ids=('parts',))
        self.assertEqual(PlacementProcess().run(locked).status, 'needs_input')
        comparison = SelectionRequest.for_design(empty(), input=SelectionInput(action='compare', candidate_refs=(element_ref(fixture()),)))
        self.assertEqual(SelectionProcess().run(comparison).status, 'needs_input')

    def test_inherited_motion_initials_preserve_element_and_block_dangling_aliases(self):
        servo = load_component(template_path('servo'))
        definition = ElementDefinition(library_id='test', element_id=servo.id, name=servo.name,
            category=servo.category, model=servo)
        package = select(empty(), definition, names=('servo',))
        instance = ObjectRef(record_id='parts', collection='instances', object_id='servo')
        resolved = resolve_design(package)
        joint = resolved.occurrence_ref(instance, 'joints', 'axis')
        request = MotionRequest.for_design(package, input=MotionInput(action='set_configuration',
            initials=(JointInitial(joint_ref=joint, value=Quantity(value=45.0, unit='deg')),)), write_record_ids=('motion',))
        result = MotionProcess().run(request)
        self.assertEqual(result.status, 'completed', result.model_dump_json())
        candidate = build_candidate(package, result.proposals[0], write_record_ids=('motion',))
        self.assertFalse([d for d in resolve_design(candidate).diagnostics if d.severity == 'error'])
        self.assertEqual(element_ref(candidate.elements[0]), element_ref(definition))
        driven_request = MotionRequest.for_design(package, input=MotionInput(motion_record_id='drivers',
            drives={'drive': Drive(joint_ref=joint, mode='position', command=Quantity(value=0.0, unit='deg'))}),
            write_record_ids=('drivers',))
        driven = MotionProcess().run(driven_request)
        driven_package = build_candidate(package, driven.proposals[0], write_record_ids=('drivers',))
        override_request = MotionRequest.for_design(driven_package, input=request.input, write_record_ids=('motion',))
        self.assertEqual(MotionProcess().run(override_request).status, 'needs_input')
        bad = MotionRequest.for_design(package, input=MotionInput(initials=(JointInitial(
            joint_ref=joint, value=Quantity(value=100000.0, unit='deg')),)), write_record_ids=('motion',))
        self.assertEqual(MotionProcess().run(bad).status, 'needs_input')

    def test_search_is_read_only_and_pins_are_immutable(self):
        with tempfile.TemporaryDirectory() as temp:
            library = ElementLibrary(Path(temp) / 'elements')
            definition = fixture('searchable')
            library.publish(definition)
            request = SelectionRequest.for_design(empty(), input=SelectionInput(action='search', query=ElementQuery(text='searchable')))
            result = SelectionProcess().run(request, ProcessContext(elements=library))
            self.assertEqual(result.status, 'completed')
            self.assertEqual(len(result.output.candidates), 1)
            self.assertFalse(result.proposals)
            self.assertEqual(len(library.versions('test', 'searchable')), 1)

    def test_numeric_selection_retains_scoped_sources_and_evidence(self):
        base = fixture()
        definition = ElementDefinition(library_id=base.library_id, element_id=base.element_id,
            name=base.name, category=base.category, model=base.model,
            sources={'sheet': Source(title='Synthetic datasheet fixture', locator='fixture:datasheet')},
            evidence={'rated': Evidence(source_ids=('sheet',), basis='datasheet', statement='Fixture-only rated voltage')},
            parameters={'voltage': ElementParameter(value=Quantity(value=5.0, unit='V'), evidence_ids=('rated',))})
        package = make_package(design_id='demo', title='Demo', elements=(definition,))
        request = SelectionRequest.for_design(package, input=SelectionInput(action='choose', chosen_ref=element_ref(definition),
            requirements={'supply': Requirement(statement='5V', parameter_code='voltage',
                min=Quantity(value=4.5, unit='V'), max=Quantity(value=5.5, unit='V'))},
            usage=DiscreteUsage(planned_count=1, instances={'part': Instance(label='Part')})), write_record_ids=('selection',))
        result = SelectionProcess().run(request)
        self.assertEqual(result.status, 'completed', result.model_dump_json())
        assessment = next(iter(result.output.candidates.values())).assessments['supply']
        self.assertEqual(assessment.outcome, 'match')
        self.assertTrue(assessment.evidence_ids)
        candidate = build_candidate(package, result.proposals[0], write_record_ids=('selection',))
        self.assertFalse([d for d in resolve_design(candidate).diagnostics if d.severity == 'error'])

    @unittest.skipUnless(importlib.util.find_spec('trimesh'), 'Optional mesh dependencies are not installed')
    def test_real_cad_fixture_has_readable_watertight_mesh(self):
        from element.io.mesh import resolve_stl
        from element.io.load import read_asset
        housing = load_component(template_path('custom_cad_housing'))
        self.assertEqual(housing.structural_role, 'housing')
        self.assertEqual(housing.cad_housing.material.name, 'PETG')
        shape = next(iter(housing.geometry.envelopes.values())).shape
        mesh = resolve_stl(shape, lambda ref: read_asset(ref, template_path('custom_cad_housing').parent, 5_000_000))
        self.assertIsNotNone(mesh)


if __name__ == '__main__':
    unittest.main()
