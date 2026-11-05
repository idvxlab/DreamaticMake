import json
import subprocess
import sys
import unittest
from pydantic import ValidationError
from engine.design import make_package
from engine.design.contracts import Markdown, ObjectRef
from element.base.frame import Pose
from process.tests.fixtures.design_pipeline import example
from process import (
    artifact_ref, DesignArtifact, HardwarePlacement, SpatialLayoutOutput,
    RequirementsOutput, Document, project_artifact,
)
from process.registry import get_process
from process.workflows import WORKFLOWS, SPECS


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.design, cls.artifacts, cls.requests = example()

    def test_nine_stage_roundtrip_and_schema(self):
        self.assertEqual(len(self.artifacts), 9)
        for stage, artifact in self.artifacts.items():
            with self.subTest(stage=stage):
                restored = DesignArtifact.model_validate_json(artifact.model_dump_json())
                self.assertEqual(artifact_ref(restored), artifact_ref(artifact))
                descriptor = get_process(stage).describe()
                self.assertEqual(descriptor.category, 'workflow')
                self.assertEqual(descriptor.required_upstream, SPECS[stage][2])
                self.assertEqual(descriptor.input_schema['properties']['process_kind']['const'], stage)
                result = get_process(stage).run(json.loads(self.requests[stage].model_dump_json()))
                self.assertEqual(result.status, 'completed')
                self.assertEqual(result.checks, ())
                self.assertEqual(result.proposals, ())
                self.assertEqual(result.output.view['artifact_ref'], artifact_ref(artifact).model_dump(mode='json'))
                self.assertEqual(project_artifact(artifact)['validation'], 'contract_only')

    def run_with(self, stage, **input_changes):
        request = self.requests[stage]
        # Revalidation in run must also reject unchecked model_copy mutations.
        return get_process(stage).run(request.model_copy(update={
            'input': request.input.model_copy(update=input_changes)}))

    def test_prepare_context_and_missing_dependencies(self):
        result = self.run_with('enclosure_detail', action='prepare', deliverable=None)
        self.assertEqual(result.status, 'completed')
        self.assertIsNone(result.output.artifact)
        self.assertEqual(len(result.output.context.elements), 1)
        self.assertEqual({a.payload.kind for a in result.output.context.upstream},
            {'requirements', 'hardware_selection', 'appearance', 'spatial_layout'})
        self.assertFalse(self.run_with('enclosure_detail', upstream={}).status == 'completed')
        missing = self.requests['enclosure_detail'].model_copy(update={'artifacts': ()})
        self.assertEqual(get_process('enclosure_detail').run(missing).status, 'needs_input')
        self.assertEqual(self.run_with('print_optimization', printer=None).status, 'needs_input')

    def test_generation_and_simulation_do_not_claim_execution(self):
        for stage in WORKFLOWS:
            result = self.run_with(stage, action='generate', deliverable=None)
            self.assertEqual(result.status, 'unsupported')
            self.assertIsNone(result.output)
        req = self.requests['spatial_layout'].model_copy(update={'requested_checks': ('collision',)})
        self.assertEqual(get_process('spatial_layout').run(req).status, 'unsupported')

    def test_stale_mixed_pins_and_designs_are_rejected(self):
        request = self.requests['spatial_layout']
        old = self.artifacts['requirements']
        revised = old.model_copy(update={'revision': 2, 'constraints': Markdown(text='Changed constraints')})
        available = tuple(revised if a.artifact_id == old.artifact_id else a for a in request.artifacts)
        upstream = dict(request.input.upstream)
        upstream['requirements'] = artifact_ref(revised)
        mixed = request.model_copy(update={'artifacts': available, 'input': request.input.model_copy(update={'upstream': upstream})})
        self.assertEqual(get_process('spatial_layout').run(mixed).status, 'needs_input')
        tampered = old.model_copy(update={'constraints': Markdown(text='Tampered content')})
        available = tuple(tampered if a.artifact_id == old.artifact_id else a for a in request.artifacts)
        self.assertEqual(get_process('spatial_layout').run(request.model_copy(update={'artifacts': available})).status, 'needs_input')
        changed = make_package(design_id='other', title='Other', elements=self.design.elements)
        wrong = get_process('spatial_layout').request_model.for_design(changed,
            input=request.input, artifacts=request.artifacts)
        self.assertEqual(get_process('spatial_layout').run(wrong).status, 'needs_input')

    def test_revision_and_duplicate_identity(self):
        old = self.artifacts['requirements']
        request = self.requests['requirements']
        updated = request.input.model_copy(update={'revision': 2, 'previous': artifact_ref(old)})
        result = get_process('requirements').run(request.model_copy(update={'input': updated, 'artifacts': (old,)}))
        self.assertEqual(result.status, 'completed')
        self.assertEqual(result.output.artifact.revision, 2)
        with self.assertRaises(ValidationError):
            self.run_with('requirements', revision=2)
        duplicate = request.model_copy(update={'artifacts': (old, old)})
        self.assertEqual(get_process('requirements').run(duplicate).status, 'needs_input')

    def test_missing_duplicate_or_unknown_hardware_placement(self):
        placements = self.artifacts['spatial_layout'].payload.placements
        for values in (placements[:1], (placements[0], placements[0]),
                (*placements, HardwarePlacement(instance_ref=ObjectRef(record_id='unknown',
                    collection='instances', object_id='a'), world_pose=Pose()))):
            result = self.run_with('spatial_layout', deliverable=SpatialLayoutOutput(placements=values))
            self.assertEqual(result.status, 'needs_input')
        request = self.requests['hardware_selection'].model_copy(update={'base': self.requests['hardware_selection'].base.model_copy(
            update={'design': make_package(design_id=self.design.manifest.design_id, title=self.design.manifest.title)})})
        self.assertEqual(get_process('hardware_selection').run(request).status, 'needs_input')

    def test_wrong_output_type_and_document_roles(self):
        with self.assertRaises(ValidationError):
            self.run_with('appearance', deliverable=self.artifacts['requirements'].payload)
        with self.assertRaises(ValidationError):
            RequirementsOutput(documents=(Document(document_id='a', role='source', title='A', body=Markdown(text='a')),
                Document(document_id='b', role='source', title='B', body=Markdown(text='b'))))

    def test_logical_layout_uses_native_terminals_and_explicit_unconnected(self):
        from element.categories import Controller
        from element.interfaces.electrical import ElectricalSpec, Terminal
        from element.schema.library import ElementDefinition
        from element.io.records import element_ref
        from engine.design import resolve_design
        from engine.design.contracts import SelectionData, Candidate, DiscreteUsage, Instance, Net
        from process import HardwareSelectionOutput, HardwareChoice, LogicalLayoutOutput
        controller = Controller(id='controller', name='Controller', platform='generic', wiring=ElectricalSpec(
            terminals={'io': Terminal(physical_pin_number='1', electrical_role='bidirectional')}))
        definition = ElementDefinition(library_id='test', element_id='controller', name='Controller',
            category='controller', model=controller)
        design = make_package(design_id='circuit', title='Circuit', elements=(definition,))
        req_process = get_process('requirements')
        req_request = req_process.request_model.for_design(design, input=self.requests['requirements'].input)
        requirements = req_process.run(req_request).output.artifact
        select_process = get_process('hardware_selection')
        select_request = select_process.request_model.for_design(design, artifacts=(requirements,), input={
            'action': 'submit', 'artifact_id': 'selected', 'upstream': {'requirements': artifact_ref(requirements)},
            'deliverable': HardwareSelectionOutput(choices=(HardwareChoice(selection_record_id='controllers',
                element_ref=element_ref(definition), instances=('a', 'b')),))})
        selected = select_process.run(select_request).output.artifact
        # Resolve native terminal addresses exactly as a host integrating the selection would.
        package = make_package(design_id='circuit', title='Circuit', elements=(definition,), records=[{
            'record_kind': 'design_record', 'design_id': 'circuit', 'record_id': 'controllers',
            'kind': 'selection', 'title': 'Controllers', 'data': SelectionData(
                candidates={'chosen': Candidate(element_ref=element_ref(definition))}, chosen_candidate_id='chosen',
                usage=DiscreteUsage(planned_count=2, instances={i: Instance(label=i) for i in ('a', 'b')})).model_dump(mode='json')}])
        resolved = resolve_design(package)
        terminals = tuple(resolved.occurrence_ref(ObjectRef(record_id='controllers', collection='instances', object_id=i),
            'terminals', 'io') for i in ('a', 'b'))
        process = get_process('logical_layout')

        def run(data):
            return process.run(process.request_model.for_design(design, artifacts=(requirements, selected), input={
                'action': 'submit', 'artifact_id': 'wiring', 'upstream': {
                    'requirements': artifact_ref(requirements), 'hardware_selection': artifact_ref(selected)},
                'deliverable': data}))

        self.assertEqual(run(LogicalLayoutOutput(nets={'signal': Net(kind='signal', members=terminals)})).status, 'completed')
        self.assertEqual(run(LogicalLayoutOutput(unconnected_terminals=terminals)).status, 'completed')
        self.assertEqual(run(LogicalLayoutOutput()).status, 'needs_input')
        self.assertEqual(run(LogicalLayoutOutput(nets={'signal': Net(kind='signal', members=terminals)},
            unconnected_terminals=terminals)).status, 'needs_input')

    def test_assembly_print_coverage_and_motion_bounds(self):
        assembly = self.artifacts['assembly_detail'].payload
        relation = assembly.relations[0].model_copy(update={'parent': 'missing'})
        result = self.run_with('assembly_detail', deliverable=assembly.model_copy(update={'relations': (relation,)}))
        self.assertEqual(result.status, 'needs_input')
        printing = self.artifacts['print_optimization'].payload
        part = printing.parts[0].model_copy(update={'source_component_id': 'missing'})
        self.assertEqual(self.run_with('print_optimization', deliverable=printing.model_copy(update={'parts': (part,)})).status, 'needs_input')
        motion = self.artifacts['motion_detail'].payload
        joint = motion.joints['hinge'].model_copy(update={'upper': None})
        with self.assertRaises(ValidationError):
            self.run_with('motion_detail', deliverable=motion.model_copy(update={'joints': {'hinge': joint}}))

    def test_cli_workflow(self):
        run = subprocess.run([sys.executable, '-B', '-m', 'process', 'request'],
            input=self.requests['requirements'].model_dump_json(), text=True,
            encoding='utf-8', capture_output=True, timeout=30)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(json.loads(run.stdout)['output']['artifact']['payload']['kind'], 'requirements')


if __name__ == '__main__':
    unittest.main()
