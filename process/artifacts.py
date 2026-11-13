"""Versioned design deliverables. Native geometry/material/electrical types stay upstream."""
from hashlib import sha256
from typing import Annotated, Literal
from pydantic import Field, StringConstraints, model_validator
from element.base.contract import Contract, Id, Sha256
from element.base.frame import Pose
from element.base.reference import AssetRef
from element.categories.housing import CADHousing
from element.interfaces.software import SoftwareProject
from element.schema.library import ElementRef
from element.io.save import canonical_json
from engine.design.contracts import Markdown, ObjectRef, Net, Joint, StructureConnection

Stage = Literal['requirements', 'appearance', 'hardware_selection', 'spatial_layout',
                'logical_layout', 'enclosure_detail', 'motion_detail', 'assembly_detail',
                'print_optimization', 'software_design', 'procurement_assembly_guide']


class Document(Contract):
    document_id: Id
    role: Literal['source', 'requirements', 'functions']
    title: str = Field(min_length=1, max_length=500)
    body: Markdown | None = None
    asset: AssetRef | None = None

    @model_validator(mode='after')
    def content(self):
        if self.body is None and self.asset is None:
            raise ValueError('Document requires Markdown or an asset')
        if self.body is not None and not self.body.text.strip() and self.asset is None:
            raise ValueError('Document cannot be empty')
        return self


class RequirementsOutput(Contract):
    kind: Literal['requirements'] = 'requirements'
    documents: tuple[Document, ...] = Field(min_length=2, max_length=128)

    @model_validator(mode='after')
    def roles(self):
        if not {'requirements', 'functions'} <= {d.role for d in self.documents}:
            raise ValueError('Both requirements and function documents are required')
        if len({d.document_id for d in self.documents}) != len(self.documents):
            raise ValueError('Duplicate document IDs')
        return self


class AppearanceImage(Contract):
    image_id: Id
    asset: AssetRef
    view: str = Field(min_length=1, max_length=500)
    caption: str = Field(default='', max_length=10000)

    @model_validator(mode='after')
    def image(self):
        if not self.asset.media_type.startswith('image/'):
            raise ValueError('Appearance requires image assets')
        return self


class AppearanceOutput(Contract):
    kind: Literal['appearance'] = 'appearance'
    images: tuple[AppearanceImage, ...] = Field(min_length=1, max_length=128)
    design_notes: Markdown = Markdown()

    @model_validator(mode='after')
    def unique(self):
        if len({i.image_id for i in self.images}) != len(self.images):
            raise ValueError('Duplicate appearance image IDs')
        return self


class HardwareChoice(Contract):
    selection_record_id: Id
    element_ref: ElementRef
    instances: tuple[Id, ...] = Field(min_length=1, max_length=1000)
    rationale: Markdown = Markdown()

    @model_validator(mode='after')
    def unique(self):
        if len(set(self.instances)) != len(self.instances):
            raise ValueError('Duplicate hardware instance IDs')
        return self


class PrototypeWiring(Contract):
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    quantity: int = Field(ge=1, le=1000)
    connections: tuple[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)], ...] = Field(min_length=1, max_length=100)
    assembly_notes: Markdown = Markdown()


class HardwareSelectionOutput(Contract):
    kind: Literal['hardware_selection'] = 'hardware_selection'
    choices: tuple[HardwareChoice, ...] = Field(min_length=1, max_length=1000)
    prototype_wiring: tuple[PrototypeWiring, ...] = Field(default=(), max_length=100, exclude_if=lambda wiring: not wiring)

    @model_validator(mode='after')
    def unique(self):
        if len({c.selection_record_id for c in self.choices}) != len(self.choices):
            raise ValueError('Duplicate selection record IDs')
        return self


class HardwarePlacement(Contract):
    instance_ref: ObjectRef
    world_pose: Pose


class SpatialLayoutOutput(Contract):
    kind: Literal['spatial_layout'] = 'spatial_layout'
    coordinate_system: Literal['world_m_xyzw'] = 'world_m_xyzw'
    placements: tuple[HardwarePlacement, ...] = Field(min_length=1, max_length=1000)


class LogicalLayoutOutput(Contract):
    kind: Literal['logical_layout'] = 'logical_layout'
    nets: dict[Id, Net] = Field(default_factory=dict)
    unconnected_terminals: tuple[ObjectRef, ...] = ()
    notes: Markdown = Markdown()


class SoftwareDesign(Contract):
    instance_ref: ObjectRef
    software: SoftwareProject
    architecture: Markdown
    control_logic: Markdown
    test_plan: Markdown

    @model_validator(mode='after')
    def authored(self):
        if not all(v and v.strip() for v in (self.software.relative_path, self.software.language, self.software.entrypoint)):
            raise ValueError('Software deliverables require path, language and entrypoint')
        if not all(v.text.strip() for v in (self.architecture, self.control_logic, self.test_plan)):
            raise ValueError('Describe architecture, control logic and test plan')
        return self


class SoftwareDesignOutput(Contract):
    kind: Literal['software_design'] = 'software_design'
    projects: tuple[SoftwareDesign, ...] = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def unique(self):
        refs = [p.instance_ref.key() for p in self.projects]
        if len(set(refs)) != len(refs): raise ValueError('Duplicate software controller instance')
        paths = [p.software.relative_path for p in self.projects]
        if len(set(paths)) != len(paths): raise ValueError('Use separate software paths for controller instances')
        return self


class CADComponent(Contract):
    component_id: Id
    model: CADHousing
    world_pose: Pose


class EnclosureDetailOutput(Contract):
    kind: Literal['enclosure_detail'] = 'enclosure_detail'
    components: tuple[CADComponent, ...] = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def unique(self):
        if len({c.component_id for c in self.components}) != len(self.components):
            raise ValueError('Duplicate CAD component IDs')
        return self


class MotionDetailOutput(Contract):
    kind: Literal['motion_detail'] = 'motion_detail'
    joints: dict[Id, Joint] = Field(default_factory=dict)
    notes: Markdown = Markdown()

    @model_validator(mode='after')
    def explicit_motion(self):
        for joint in self.joints.values():
            if joint.source is not None:
                raise ValueError('Intrinsic joints remain element-owned')
            if joint.kind != 'fixed' and (joint.axis is None or joint.initial is None):
                raise ValueError('Moving joints require an axis and initial configuration')
            if joint.kind in ('revolute', 'prismatic') and (joint.lower is None or joint.upper is None):
                raise ValueError('Bounded motion requires an explicit range')
        return self


class AssemblyRelation(Contract):
    relation_id: Id
    # Component IDs or hardware instance keys from the pinned input artifacts.
    parent: str = Field(min_length=1, max_length=512)
    child: str = Field(min_length=1, max_length=512)
    kind: Literal['fixed', 'follows', 'joint']
    relative_pose: Pose
    joint_id: Id | None = None
    notes: Markdown = Markdown()

    @model_validator(mode='after')
    def joint(self):
        if self.kind == 'joint' and self.joint_id is None:
            raise ValueError('Joint assembly requires a motion joint ID')
        if self.parent == self.child:
            raise ValueError('Cannot assemble a component to itself')
        return self


class AssemblyDetailOutput(EnclosureDetailOutput):
    kind: Literal['assembly_detail'] = 'assembly_detail'
    relations: tuple[AssemblyRelation, ...] = Field(default=(), max_length=2000)
    engineering_connections: tuple[StructureConnection, ...] = ()


class PrinterConstraints(Contract):
    process: Literal['fdm', 'sla', 'sls', 'other']
    build_volume_m: tuple[float, float, float]
    min_feature_m: float = Field(gt=0)
    resolution_m: float = Field(gt=0)
    max_unsupported_angle_deg: float = Field(ge=0, le=90)
    notes: Markdown = Markdown()

    @model_validator(mode='after')
    def positive(self):
        if any(v <= 0 for v in self.build_volume_m):
            raise ValueError('Build volume must be positive')
        return self


class PrintPart(Contract):
    source_component_id: Id
    optimized: CADComponent
    # Transform from component coordinates into printer coordinates; +Z is build direction.
    build_pose: Pose
    support_strategy: Markdown
    feature_changes: Markdown


class PrintOptimizationOutput(Contract):
    kind: Literal['print_optimization'] = 'print_optimization'
    parts: tuple[PrintPart, ...] = Field(min_length=1, max_length=1000)


GuideSection = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


class ProcurementAssemblyGuideOutput(Contract):
    kind: Literal['procurement_assembly_guide'] = 'procurement_assembly_guide'
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    procurement: GuideSection = Field(description='Markdown list or table with quantities, sources and purchase checks')
    assembly: GuideSection = Field(description='Markdown instructions for preparation, assembly and fit checks')
    verification: GuideSection = Field(description='Markdown record of verified results, open issues and first-article checks')


Deliverable = Annotated[RequirementsOutput | AppearanceOutput | HardwareSelectionOutput |
    SpatialLayoutOutput | LogicalLayoutOutput | EnclosureDetailOutput | MotionDetailOutput |
    AssemblyDetailOutput | PrintOptimizationOutput | SoftwareDesignOutput |
    ProcurementAssemblyGuideOutput, Field(discriminator='kind')]


class ArtifactRef(Contract):
    artifact_id: Id
    revision: int = Field(ge=1)
    content_hash: Sha256


class DesignArtifact(Contract):
    record_kind: Literal['process_artifact'] = 'process_artifact'
    schema_version: Literal['0.2.0-draft'] = '0.2.0-draft'
    design_id: Id
    artifact_id: Id
    revision: int = Field(ge=1)
    previous: ArtifactRef | None = None
    source_snapshot_id: Sha256
    dependencies: dict[Stage, ArtifactRef] = Field(default_factory=dict)
    source_documents: tuple[Document, ...] = ()
    constraints: Markdown = Markdown()
    printer: PrinterConstraints | None = None
    payload: Deliverable
    # Acceptance records authored data only; no geometric or manufacturing certification.
    validation: Literal['contract_only'] = 'contract_only'


def artifact_ref(artifact: DesignArtifact) -> ArtifactRef:
    return ArtifactRef(artifact_id=artifact.artifact_id, revision=artifact.revision,
        content_hash=sha256(canonical_json(artifact).encode('utf-8')).hexdigest())
