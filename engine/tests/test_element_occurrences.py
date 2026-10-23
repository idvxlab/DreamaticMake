"""Integration contract: element owns the unit; engine owns occurrence and relations."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from element.io.components import load_component
from element.schema.library import ElementDefinition
from element.library import ElementLibrary
from element.tests.test_library import fixture
from engine.design import *
from engine.design.contracts import ElementBinding, ObjectRef, InheritedObject
from engine.design.bom import derive_bom
from engine.design.documents import export_documents, import_documents


def definition(name='servo'):
    model = load_component(Path('examples/element') / (name + '.json'))
    return ElementDefinition(library_id='test', element_id=model.id, revision=model.revision,
        name=model.name, category=model.category, model=model)


def edited(package, extra=(), records=None):
    return make_package(design_id=package.manifest.design_id, title=package.manifest.title,
        records=tuple(records if records is not None else package.records) + tuple(extra), elements=package.elements)


def declaration(kind, collection, binding, overrides=None):
    return {'kind': kind, 'design_id': 'demo', 'record_id': 'custom', 'title': 'Scheme differences',
        'data': {collection: {'alias': {'source': binding.model_dump(mode='json'), 'overrides': overrides or {}}}}}


class OccurrenceTests(unittest.TestCase):
    def test_selection_alone_resolves_all_templates_without_legacy_lowering(self):
        with patch('engine.adapters.elements.to_bundle', side_effect=AssertionError('legacy adapter used')):
            for path in Path('examples/element').glob('*.json'):
                if path.name.endswith('.scenario.json'): continue
                with self.subTest(path=path):
                    d = definition(path.stem)
                    result = instantiate_element(d, design_id='demo')
                    p = parse_package(result['package'])
                    self.assertEqual([r.kind for r in p.records], ['selection'])
                    self.assertNotIn('losses', result)
                    r = resolve_design(p)
                    self.assertFalse([e for e in r.diagnostics if e.severity == 'error'], r.diagnostics)
                    for collection, values in d.collections().items():
                        for name, native in values.items():
                            self.assertEqual(r.element_objects[('selection/instances/instance', collection, name)], native)
                    project_design(p)

    def test_library_and_embedded_resolution_agree_and_check_hashes(self):
        d = fixture()
        p = parse_package(instantiate_element(d, design_id='demo')['package'])
        external = make_package(design_id='demo', title=p.manifest.title, records=p.records)
        with tempfile.TemporaryDirectory() as directory:
            library = ElementLibrary(directory)
            library.publish(d)
            self.assertEqual(resolve_design(p).objects, resolve_design(external, library).objects)
        raw = d.model_dump(mode='json'); raw['name'] = 'Forged'
        bad = make_package(design_id='demo', title='demo', records=p.records, elements=(ElementDefinition.model_validate_json(json.dumps(raw)),))
        with self.assertRaisesRegex(ValueError, 'pin/hash'): resolve_design(bad)

    def test_source_only_inherits_pin_ratings_and_rebinds_internal_refs(self):
        d = definition('described_battery')
        p = parse_package(instantiate_element(d, design_id='demo')['package'])
        r = resolve_design(p)
        instance = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        name = next(iter(d.collections()['terminals']))
        binding = ElementBinding(instance_ref=instance, local_ref={'collection': 'terminals', 'object_id': name})
        p2 = edited(p, [declaration('circuit_energy', 'terminals', binding)])
        r2 = resolve_design(p2)
        alias = r2.objects['custom/terminals/alias']
        native = d.collections()['terminals'][name]
        self.assertEqual(alias.spec.physical_pin_number, native.physical_pin_number)
        self.assertEqual(alias.spec.voltage_limits.model_dump() if alias.spec.voltage_limits else None,
                         native.voltage_limits.model_dump() if native.voltage_limits else None)
        self.assertEqual(r2.element_object(binding), native)
        self.assertNotIn(r.occurrence_ref(instance, 'terminals', name).key(), r2.objects)
        self.assertEqual(r2.occurrence_ref(instance, 'terminals', name).key(), 'custom/terminals/alias')
        self.assertFalse([e for e in r2.diagnostics if e.severity == 'error'], r2.diagnostics)

    def test_intrinsic_changes_are_rejected_and_source_conflicts_reported(self):
        p = parse_package(instantiate_element(fixture(), design_id='demo')['package'])
        instance = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        binding = ElementBinding(instance_ref=instance, local_ref={'collection': 'envelopes', 'object_id': 'solid'})
        bad = declaration('structure', 'geometry', binding, {'shape': {'kind': 'sphere', 'radius_m': 3.0}})
        self.assertIn('element.override_intrinsic', [d.code for d in resolve_design(edited(p, [bad])).diagnostics])
        r = resolve_design(p)
        value = r.get(r.occurrence_ref(instance, 'envelopes', 'solid')).model_dump(mode='json')
        value['shape'] = {'kind': 'sphere', 'radius_m': 3.0}
        bad['data']['geometry']['alias'] = value
        changed = edited(p, [bad])
        self.assertIn('element.source_conflict', [d.code for d in resolve_design(changed).diagnostics])
        with self.assertRaises(ValueError): compile_design(changed)

    def test_multiple_occurrences_are_isolated_and_connect_without_attribute_copies(self):
        p = parse_package(instantiate_element(definition('described_battery'), design_id='demo')['package'])
        raw = p.records[0].model_dump(mode='json')
        usage = raw['data']['usage']; usage['planned_count'] = 2
        usage['instances']['second'] = {'label': 'Second', 'pose': {'translation_m': [1.0, 0.0, 0.0]}}
        p = edited(p, records=[raw]); r = resolve_design(p)
        a = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        b = ObjectRef(record_id='selection', collection='instances', object_id='second')
        terminal = next(iter(definition('described_battery').collections()['terminals']))
        ar, br = (r.occurrence_ref(i, 'terminals', terminal) for i in (a,b))
        net = {'kind': 'circuit_energy', 'design_id': 'demo', 'record_id': 'wiring', 'title': 'Connections',
               'data': {'nets': {'n': {'kind': 'signal', 'members': [ar.model_dump(), br.model_dump()]}}}}
        p = edited(p, [net]); r = resolve_design(p)
        self.assertNotEqual(ar, br)
        self.assertEqual(r.get(ar).instance_ref, a)
        self.assertEqual(r.get(br).instance_ref, b)
        self.assertFalse([e for e in r.diagnostics if e.severity == 'error'], r.diagnostics)
        self.assertEqual(derive_bom(p)['items'][0]['quantity']['value'], 2)

    def test_library_ports_and_behavior_remain_complete(self):
        d = definition('servo'); raw = d.model_dump(mode='json')
        raw['model']['control'] = {'model_id': 'pass', 'inputs': {'value': {'kind': 'fixture', 'channel': 'angle'}}, 'output_type': {'kind': 'scalar', 'unit': 'rad'}}
        body = d.model.geometry.root_body
        raw['information_ports'] = {'command': {'name': 'Command', 'direction': 'in', 'data_type': 'position', 'required': True, 'frame': {'body_id': body}}}
        raw['energy_ports'] = {'shaft': {'name': 'Shaft', 'carrier': 'rotational', 'direction': 'out', 'ratings': {'torque': {'value': 1.0, 'unit': 'N*m'}}}}
        d = ElementDefinition.model_validate_json(json.dumps(raw))
        r = resolve_design(instantiate_element(d, design_id='demo')['package'])
        instance = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        self.assertTrue(r.get(r.occurrence_ref(instance, 'information_ports', 'command')).required)
        self.assertEqual(r.get(r.occurrence_ref(instance, 'energy_ports', 'shaft')).spec.ratings['torque'].value, 1.0)
        self.assertTrue(d.collections()['behaviors'])
        for name, native in d.collections()['behaviors'].items():
            unit = r.get(r.occurrence_ref(instance, 'behaviors', name))
            self.assertEqual(r.element_object(unit.source), native)

    def test_missing_and_wrong_source_do_not_crash_views(self):
        p = parse_package(instantiate_element(fixture(), design_id='demo')['package'])
        i = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        for collection, name in [('envelopes', 'absent'), ('bodies', 'body')]:
            b = ElementBinding(instance_ref=i, local_ref={'collection': collection, 'object_id': name})
            p2 = edited(p, [declaration('structure', 'geometry', b)])
            self.assertTrue([d for d in project_design(p2)['design_diagnostics'] if d['severity'] == 'error'])

    def test_placement_difference_roundtrip_does_not_change_element(self):
        p = parse_package(instantiate_element(fixture(), design_id='demo')['package'])
        i = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        b = ElementBinding(instance_ref=i, local_ref={'collection': 'bodies', 'object_id': 'body'})
        p = edited(p, [declaration('structure', 'bodies', b, {'pose': {'translation_m': [2.0, 0.0, 0.0]}, 'placement': 'specified'})])
        self.assertIsInstance(p.records[-1].data.bodies['alias'], InheritedObject)
        self.assertEqual(resolve_design(p).objects['custom/bodies/alias'].pose.translation_m[0], 2.0)
        self.assertEqual(compile_design(p)['snapshot_id'], snapshot_id(p.manifest))
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(import_documents(export_documents(p, Path(directory)/'export')), p)
        self.assertEqual(p.elements[0], fixture())

    def test_joint_initial_difference_updates_body_pose_and_rejects_out_of_range(self):
        from element.base.frame import Pose
        p = parse_package(instantiate_element(definition('servo'), design_id='demo', pose={})['package'])
        i = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        binding = ElementBinding(instance_ref=i, local_ref={'collection': 'joints', 'object_id': 'axis'})
        change = declaration('motion', 'joints', binding, {'initial': {'value': 0.5}})
        r = resolve_design(edited(p, [change]))
        joint = r.objects['custom/joints/alias']
        body = r.get(joint.child_body)
        expected = joint.parent_anchor.compose(Pose.axis_angle(joint.axis, joint.initial.si_value)).compose(joint.child_anchor.inverse())
        self.assertEqual(body.pose, expected)
        self.assertEqual(joint.initial.value, 0.5)
        self.assertFalse([d for d in r.diagnostics if d.severity == 'error'], r.diagnostics)
        change['data']['joints']['alias']['overrides']['initial']['value'] = 1e9
        self.assertIn('element.override_invalid', [d.code for d in resolve_design(edited(p, [change])).diagnostics])

    def test_duplicate_sources_and_version_one_are_rejected(self):
        p = parse_package(instantiate_element(fixture(), design_id='demo')['package'])
        i = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        binding = ElementBinding(instance_ref=i, local_ref={'collection': 'bodies', 'object_id': 'body'})
        change = declaration('structure', 'bodies', binding)
        change['data']['bodies']['duplicate'] = change['data']['bodies']['alias']
        self.assertIn('element.duplicate_source', [d.code for d in resolve_design(edited(p, [change])).diagnostics])
        raw = p.model_dump(mode='json'); raw['schema_version'] = '1.0.0-draft'
        with self.assertRaises(ValueError): parse_package(raw)

    def test_selected_units_cannot_duplicate_intrinsic_objects_without_source(self):
        p = parse_package(instantiate_element(fixture(), design_id='demo')['package'])
        body = {'instance_ref': {'record_id': 'selection', 'collection': 'instances', 'object_id': 'instance'}}
        extra = {'kind': 'structure', 'record_id': 'extra', 'design_id': 'demo', 'title': 'Duplicate',
                 'data': {'bodies': {'duplicate': body}}}
        r = resolve_design(edited(p, [extra]))
        self.assertIn('element.source_required', [d.code for d in r.diagnostics])

    def test_projection_separates_authored_and_resolved_records(self):
        p = instantiate_element(definition('motor_driver'), design_id='demo')['package']
        view = project_design(p)
        self.assertEqual(len(view['records']), 1)
        self.assertGreater(len(view['resolved_records']), 1)
        r = resolve_design(p)
        i = ObjectRef(record_id='selection', collection='instances', object_id='instance')
        unit = r.get(r.occurrence_ref(i, 'behaviors', 'enable'))
        self.assertEqual(set(unit.inputs), {'value'})
        self.assertEqual(set(unit.outputs), {'value'})
        self.assertEqual(r.element_object(unit.source).inputs['value'].channel, 'enable')

    def test_power_terminals_are_element_owned_in_both_consumers(self):
        from engine.adapters.elements import to_definition
        for name in ('usb_supply', 'described_battery'):
            d = definition(name)
            r = resolve_design(instantiate_element(d, design_id='demo')['package'])
            i = ObjectRef(record_id='selection', collection='instances', object_id='instance')
            terminals = d.collections()['terminals']
            self.assertEqual(set(terminals), {'positive', 'ground'})
            self.assertEqual(terminals, to_definition(d).electronic.electrical.terminals)
            for name, native in terminals.items():
                terminal = r.get(r.occurrence_ref(i, 'terminals', name))
                self.assertEqual(terminal.spec.physical_pin_number, native.physical_pin_number)
                self.assertEqual(terminal.spec.nominal_voltage, native.nominal_voltage)
            self.assertFalse([e for e in r.diagnostics if e.severity == 'error'], r.diagnostics)

    def test_scheme_views_use_element_validation_rules(self):
        from element.interfaces.electrical import Terminal as ElementTerminal
        from engine.design.contracts import TerminalSpec, DeclarativeUnit
        for cls in (ElementTerminal, TerminalSpec):
            with self.assertRaises(ValueError):
                cls(physical_pin_number='1', electrical_role='passive', drive='push_pull')
            with self.assertRaises(ValueError):
                cls(physical_pin_number='1', electrical_role='input', nominal_voltage={'value': 3.3, 'unit': 'V'})
        with self.assertRaises(ValueError):
            DeclarativeUnit(name='Invalid', behavior={'kind': 'state_machine', 'model_id': 'state_machine',
                'output_type': {'kind': 'boolean'}, 'initial_state': 'missing', 'states': {'ready': True}})

if __name__ == '__main__': unittest.main()
