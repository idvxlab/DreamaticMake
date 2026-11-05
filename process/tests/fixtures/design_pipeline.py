"""Offline authored-data example for all nine workflows; no generation backend is used."""
import json
from element.categories import Structure, CADHousing, CADHousingSpec, HousingMaterial
from element.interfaces.geometry import Box
from element.schema.library import ElementDefinition
from element.io.records import element_ref
from element.base.frame import Pose
from element.base.reference import AssetRef
from element.base.quantity import Quantity
from engine.design import make_package, resolve_design
from engine.design.contracts import Markdown, ObjectRef, Joint
from process import (
    Document, RequirementsOutput, AppearanceOutput, AppearanceImage, HardwareSelectionOutput,
    HardwareChoice, SpatialLayoutOutput, HardwarePlacement, LogicalLayoutOutput,
    CADComponent, EnclosureDetailOutput, MotionDetailOutput, AssemblyDetailOutput,
    AssemblyRelation, PrintOptimizationOutput, PrintPart, PrinterConstraints, artifact_ref,
)
from process.registry import get_process
from process.workflows import SPECS


def example():
    model = Structure.from_shape(id='hardware', name='Hardware fixture', shape=Box(size_m=(0.01, 0.01, 0.01)))
    definition = ElementDefinition(library_id='example', element_id=model.id, name=model.name,
        category='structure', model=model)
    design = make_package(design_id='nine_stage_demo', title='Nine-stage example', elements=(definition,))
    artifacts, requests = {}, {}

    def submit(stage, data, **kwargs):
        process = get_process(stage)
        required = SPECS[stage][2]
        upstream = {s: artifact_ref(artifacts[s]) for s in required}
        if stage == 'assembly_detail':
            upstream['motion_detail'] = artifact_ref(artifacts['motion_detail'])
        request = process.request_model.for_design(design, artifacts=tuple(artifacts.values()),
            input=dict(action='submit', upstream=upstream, artifact_id=stage, deliverable=data, **kwargs))
        result = process.run(request)
        if result.status != 'completed':
            raise ValueError(result.model_dump_json())
        artifacts[stage], requests[stage] = result.output.artifact, request

    submit('requirements', RequirementsOutput(documents=(
        Document(document_id='requirements', role='requirements', title='Requirements', body=Markdown(text='Small moving enclosure.')),
        Document(document_id='functions', role='functions', title='Functions', body=Markdown(text='Rotate the second component.')))),
        source_documents=(Document(document_id='brief', role='source', title='Brief', body=Markdown(text='Design a desktop mechanism.')),))
    # The image is an unresolved asset reference, deliberately never fetched or claimed generated.
    submit('appearance', AppearanceOutput(images=(AppearanceImage(image_id='front', view='front',
        asset=AssetRef(artifact_id='authored_image', sha256='0' * 64, media_type='image/png')),)))
    submit('hardware_selection', HardwareSelectionOutput(choices=(HardwareChoice(
        selection_record_id='hardware', element_ref=element_ref(definition), instances=('a', 'b')),)))
    instances = tuple(ObjectRef(record_id='hardware', collection='instances', object_id=i) for i in ('a', 'b'))
    submit('spatial_layout', SpatialLayoutOutput(placements=tuple(HardwarePlacement(instance_ref=ref,
        world_pose=Pose(translation_m=(index * 0.02, 0.0, 0.0))) for index, ref in enumerate(instances))))
    submit('logical_layout', LogicalLayoutOutput(notes=Markdown(text='Mechanical fixture has no terminals.')))
    shell = CADHousing.from_shape(id='shell', name='Authored shell fixture', shape=Box(size_m=(0.05, 0.04, 0.03)),
        cad_housing=CADHousingSpec(material=HousingMaterial(name='PETG')))
    components = (CADComponent(component_id='shell', model=shell, world_pose=Pose()),)
    submit('enclosure_detail', EnclosureDetailOutput(components=components))
    # Use the same native occurrence addresses as engine resolution, without persisting a selection.
    from engine.design.contracts import SelectionData, Candidate, DiscreteUsage, Instance
    selected = make_package(design_id=design.manifest.design_id, title='Reference context', elements=(definition,), records=[{
        'record_kind': 'design_record', 'design_id': design.manifest.design_id, 'record_id': 'hardware',
        'kind': 'selection', 'title': 'Hardware', 'data': SelectionData(candidates={'chosen': Candidate(element_ref=element_ref(definition))},
            chosen_candidate_id='chosen', usage=DiscreteUsage(planned_count=2, instances={i: Instance(label=i) for i in ('a', 'b')})).model_dump(mode='json')}])
    resolved = resolve_design(selected)
    bodies = [resolved.occurrence_ref(ref, 'bodies', 'body') for ref in instances]
    submit('motion_detail', MotionDetailOutput(joints={'hinge': Joint(parent_body=bodies[0], child_body=bodies[1],
        kind='revolute', axis=(0.0, 0.0, 1.0), lower=Quantity(value=0.0, unit='deg'),
        upper=Quantity(value=90.0, unit='deg'), initial=Quantity(value=30.0, unit='deg'))}))
    submit('assembly_detail', AssemblyDetailOutput(components=components, relations=(AssemblyRelation(
        relation_id='mount', parent='shell', child=instances[0].key(), kind='fixed', relative_pose=Pose()),)))
    submit('print_optimization', PrintOptimizationOutput(parts=(PrintPart(source_component_id='shell',
        optimized=components[0], build_pose=Pose(), support_strategy=Markdown(text='Authored proposal; support not computed.'),
        feature_changes=Markdown(text='No geometry change in this fixture.')),)), printer=PrinterConstraints(
            process='fdm', build_volume_m=(0.2, 0.2, 0.2), min_feature_m=0.0008,
            resolution_m=0.0002, max_unsupported_angle_deg=45.0))
    return design, artifacts, requests


if __name__ == '__main__':
    _, artifacts, _ = example()
    print(json.dumps({stage: artifact_ref(a).model_dump(mode='json') for stage, a in artifacts.items()}, indent=2))
