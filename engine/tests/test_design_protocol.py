import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from engine.design import *
from engine.design.contracts import KINDS
from engine.design.io import export_schema
from engine.design.migrate import migrate_layout, instantiate_element
from engine.design.bom import derive_bom
from element.tests.test_library import fixture
from engine.design.documents import export_documents, import_documents

def record(kind, data=None, **changes):
    return {'design_id': 'demo', 'record_id': kind, 'title': kind, 'kind': kind, 'data': data or {}, **changes}

class DesignProtocolTests(unittest.TestCase):
    def test_markdown_export_edit_import_has_one_authoritative_body(self):
        p = make_package(design_id='demo', title='Demo', records=[record('analysis', {'body': {'text': '# Original'}})])
        with tempfile.TemporaryDirectory() as folder:
            root = export_documents(p, Path(folder) / 'export')
            self.assertEqual(import_documents(root), p)
            (root / 'analysis/analysis.md').write_text('# Changed', encoding='utf-8')
            changed = import_documents(root)
            self.assertEqual(changed.manifest.revision, 2)
            self.assertEqual(changed.records[0].revision, 2)
            self.assertEqual(changed.records[0].data.body.text, '# Changed')

    def test_multi_instance_bom_counts_selection_only(self):
        base = instantiate_element(fixture(), design_id='demo')['package']
        p = parse_package(base)
        records = [r.model_dump(mode='json') for r in p.records]
        selected = next(r for r in records if r['kind'] == 'selection')
        usage = selected['data']['usage']
        first = next(iter(usage['instances'].values()))
        usage['instances']['second'] = {**first, 'label': 'Second housing', 'occurrence_map': {}}
        usage['planned_count'] = 2
        package = make_package(design_id='demo', title='Demo', records=records, elements=p.elements)
        self.assertEqual(derive_bom(package)['items'][0]['quantity']['value'], 2)

    def test_same_terminal_cannot_be_on_two_nets(self):
        terminal = {'record_id': 'circuit_energy', 'collection': 'terminals', 'object_id': 'a'}
        p = make_package(design_id='demo', title='Demo', records=[record('circuit_energy', {
            'nets': {'one': {'kind': 'power', 'members': [terminal]}, 'two': {'kind': 'power', 'members': [terminal]}}})])
        self.assertIn('net.multiple', [d.code for d in resolve_design(p).diagnostics])

    def test_eight_layers_roundtrip_and_schema(self):
        p = make_package(design_id='demo', title='Demo', records=[record(k) for k in KINDS])
        self.assertEqual(parse_package(p.model_dump_json()), p)
        self.assertEqual(set(p.manifest.layers), set(KINDS))
        self.assertEqual(len(resolve_design(p).records), 8)
        self.assertEqual(len(export_schema('design_record')['oneOf']), 8)

    def test_kind_payload_mismatch_and_unknown_fields(self):
        with self.assertRaises(ValueError): parse_record(record('analysis', {'bodies': {}}))
        with self.assertRaises(ValueError): parse_record(record('function', {'body': {'text': 'x', 'execute': True}}))
        with self.assertRaisesRegex(ValueError, 'Duplicate'): parse_record('{"kind":"analysis","kind":"logic"}')

    def test_markdown_is_inert_and_hash_bound(self):
        a = record('analysis', {'body': {'text': '```python\nraise RuntimeError()\n```'}})
        b = record('analysis', {'body': {'text': 'Changed'}})
        self.assertNotEqual(record_ref(parse_record(a)), record_ref(parse_record(b)))
        project_design(make_package(design_id='demo', title='Demo', records=[a]))

    def test_snapshot_pins_and_cross_design(self):
        p = make_package(design_id='demo', title='Demo', records=[record('analysis')])
        forged = p.model_dump(mode='json'); forged['records'][0]['title'] = 'Changed'
        with self.assertRaisesRegex(ValueError, 'pin/hash'): resolve_design(forged)
        with self.assertRaisesRegex(ValueError, 'Cross-design'):
            resolve_design(make_package(design_id='other', title='Other', records=[record('analysis')]))

    def test_missing_ref_is_editable_and_reported(self):
        p = make_package(design_id='demo', title='Demo', records=[record('function', {
            'realizations': [{'record_id': 'selection', 'collection': 'instances', 'object_id': 'fan'}]})])
        report = check_design(p)
        self.assertEqual(report['outcome'], 'fail')
        self.assertIn('reference.unresolved', [d['code'] for d in report['diagnostics']])
        self.assertEqual(project_design(p)['snapshot_id'], snapshot_id(p.manifest))

    def test_cycles_do_not_crash_projection(self):
        records = [record('structure', {'bodies': {'a': {
            'instance_ref': {'record_id': 'selection', 'collection': 'instances', 'object_id': 'a'},
            'parent_body': {'record_id': 'structure', 'collection': 'bodies', 'object_id': 'a'},
            'pose': {}, 'placement': 'specified'}}})]
        p = make_package(design_id='demo', title='Demo', records=records)
        self.assertTrue(project_design(p)['projection_omissions'])
        self.assertIn('structure.cycle', [d.code for d in resolve_design(p).diagnostics])

    def test_motion_units_and_flow_alias(self):
        body = {'record_id': 'structure', 'collection': 'bodies', 'object_id': 'a'}
        with self.assertRaises(ValueError):
            parse_record(record('motion', {'joints': {'axis': {'parent_body': body, 'child_body': body,
                'kind': 'revolute', 'initial': {'value': 1.0, 'unit': 'mm'}}}}))
        edge = {'domain': 'information', 'from': body, 'to': [body]}
        p = make_package(design_id='demo', title='Demo', records=[record('flow', {'edges': {'e': edge}})])
        self.assertEqual(parse_package(p.model_dump_json()), p)
        self.assertIn('from', p.records[0].model_dump(mode='json')['data']['edges']['e'])

    def test_store_cas_and_immutable_history(self):
        with tempfile.TemporaryDirectory() as folder:
            store = DesignStore(Path(folder) / 'design.sqlite3')
            p = make_package(design_id='demo', title='Demo', records=[record('analysis')])
            store.commit(p, expected_manifest_revision=0)
            with self.assertRaises(RevisionConflict): store.commit(p, expected_manifest_revision=0)
            p2 = make_package(design_id='demo', title='Demo', revision=2,
                records=[record('analysis', {'body': {'text': 'New'}}, revision=2)])
            store.commit(p2, expected_manifest_revision=1)
            self.assertEqual(store.read('demo', 1), p)
            self.assertEqual(store.read('demo'), p2)
            bad = make_package(design_id='demo', title='Demo', revision=3,
                records=[record('analysis', {'body': {'text': 'Overwrite'}}, revision=2)])
            with self.assertRaisesRegex(RevisionConflict, 'immutable'): store.commit(bad, expected_manifest_revision=2)

    def test_layout_migration_preserves_objects_and_reports_loss(self):
        raw = {'record_kind': 'layout_draft', 'layout_version': 1, 'entities': {'fan': {'name': 'Fan'}},
            'bodies': {'fan/bodies/body': {'entity': 'fan', 'pose': {}}},
            'ports': {'a': {'entity': 'fan', 'domain': 'material'}, 'b': {'entity': 'fan', 'domain': 'material'}},
            'edges': {'tube': {'domain': 'material', 'members': ['a','b']}}}
        migrated = migrate_layout(raw, design_id='demo')
        self.assertEqual(migrated, migrate_layout(raw, design_id='demo'))
        self.assertTrue(migrated['losses'])
        view = project_design(migrated['package'])
        self.assertEqual(len(view['draft']['bodies']), 1)
        self.assertEqual(len(view['draft']['ports']), 2)

    def test_instantiation_bom_and_real_collision_check(self):
        result = instantiate_element(fixture(), design_id='demo')
        p = result['package']
        r = resolve_design(p)
        self.assertFalse([d for d in r.diagnostics if d.severity == 'error'], r.diagnostics)
        bom = derive_bom(p)
        self.assertEqual(bom['items'][0]['quantity']['value'], 1)
        self.assertEqual(compile_design(p)['snapshot_id'], bom['snapshot_id'])
        report = check_design(p, 'collision')
        self.assertEqual(report['status'], 'completed')
        self.assertTrue(report['result']['check']['checked'])
        self.assertEqual(report['snapshot_id'], bom['snapshot_id'])

    def test_unsupported_checks_do_not_claim_pass(self):
        p = make_package(design_id='demo', title='Demo')
        report = check_design(p, 'thermal')
        self.assertEqual(report['status'], 'unsupported')
        self.assertEqual(report['outcome'], 'unknown')

    def test_cli_design_request_and_schema(self):
        p = make_package(design_id='demo', title='Demo')
        run = subprocess.run([sys.executable, '-B', '-m', 'engine', 'request'], input=json.dumps({
            'request_id': 'design-test', 'method': 'design_project', 'design': p.model_dump(mode='json')}),
            text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(json.loads(run.stdout)['payload']['snapshot_id'], snapshot_id(p.manifest))

if __name__ == '__main__': unittest.main()
