"""Nine artifact-oriented workflows, with no agent/provider or persistence dependency."""
from typing import Generic, Literal, TypeVar
from pydantic import Field, JsonValue, model_validator
from element.base.contract import Contract, Id
from element.schema.library import ElementDefinition
from engine.design.contracts import Markdown, ObjectRef
from process.artifacts import (
    Stage, Document, ArtifactRef, DesignArtifact, PrinterConstraints, artifact_ref,
)
from process.base import DesignProcess, need
from process.contracts import ProcessRequest, ProcessResult


D = TypeVar('D', bound=Contract)


class WorkflowInput(Contract, Generic[D]):
    action: Literal['prepare', 'submit', 'generate'] = 'prepare'
    upstream: dict[Stage, ArtifactRef] = Field(default_factory=dict)
    source_documents: tuple[Document, ...] = Field(default=(), max_length=128)
    constraints: Markdown = Markdown()
    printer: PrinterConstraints | None = None
    artifact_id: Id = 'deliverable'
    revision: int = Field(default=1, ge=1)
    previous: ArtifactRef | None = None
    deliverable: D | None = None

    @model_validator(mode='after')
    def revision_pin(self):
        if self.revision == 1 and self.previous is not None:
            raise ValueError('First revision cannot have a previous pin')
        if self.revision > 1 and (self.previous is None or
                self.previous.artifact_id != self.artifact_id or self.previous.revision + 1 != self.revision):
            raise ValueError('Revision requires the exact preceding artifact pin')
        return self


class WorkflowRequest(ProcessRequest[WorkflowInput[D]], Generic[D]):
    schema_version: Literal['0.2.0-draft'] = '0.2.0-draft'
    artifacts: tuple[DesignArtifact, ...] = Field(default=(), max_length=2000)
    # This interface validates authored deliverables. Engine checks apply after explicit integration.
    requested_checks: tuple[str, ...] = ()


class ContextPack(Contract):
    upstream: tuple[DesignArtifact, ...] = ()
    source_documents: tuple[Document, ...] = ()
    elements: tuple[ElementDefinition, ...] = ()
    library_search_available: bool = False
    constraints: Markdown = Markdown()
    printer: PrinterConstraints | None = None


class WorkflowOutput(Contract):
    context: ContextPack
    artifact: DesignArtifact | None = None
    # View data has a stable artifact pin; it is a projection, never an alternative source of truth.
    view: dict[str, JsonValue] = Field(default_factory=dict)
    limitations: tuple[str, ...] = (
        'Submitted deliverables passed contract/context validation only.',
        'No image/CAD generation, geometry simulation, slicing or manufacturing verification was executed.',
    )


class WorkflowResult(ProcessResult[WorkflowOutput]):
    schema_version: Literal['0.2.0-draft'] = '0.2.0-draft'


def _instances(selection):
    return {ObjectRef(record_id=c.selection_record_id, collection='instances', object_id=i).key(): c
        for c in selection.choices for i in c.instances}


def _closure(request):
    """Resolve exact pins and a consistent dependency DAG, rejecting mixed upstream revisions."""
    from process.workflows import SPECS

    by_id = {}
    for artifact in request.artifacts:
        if artifact.artifact_id in by_id:
            raise ValueError('Provide one revision per artifact ID')
        by_id[artifact.artifact_id] = artifact
    result, active = {}, set()

    def visit(stage, pin):
        artifact = by_id.get(pin.artifact_id)
        if artifact is None:
            raise KeyError(pin.artifact_id)
        if artifact_ref(artifact) != pin or artifact.payload.kind != stage:
            raise ValueError('Upstream hash, revision or stage mismatch')
        if artifact.design_id != request.base.design.manifest.design_id or artifact.source_snapshot_id != request.base.snapshot_id:
            raise ValueError('Upstream belongs to a different design snapshot')
        if stage in active:
            raise ValueError('Cyclic artifact dependencies')
        if stage in result:
            if artifact_ref(result[stage]) != pin:
                raise ValueError('Mixed upstream revisions; downstream artifact is stale')
            return
        required, optional = SPECS[stage][2:4]
        if not set(required) <= artifact.dependencies.keys() or set(artifact.dependencies) - set(required + optional):
            raise ValueError('Upstream artifact has an invalid dependency contract')
        active.add(stage)
        for dependency, dependency_pin in artifact.dependencies.items():
            visit(dependency, dependency_pin)
        active.remove(stage)
        result[stage] = artifact

    for stage, pin in request.input.upstream.items():
        visit(stage, pin)
    return result, by_id


def project_artifact(artifact: DesignArtifact) -> dict:
    """JSON view contract for host renderers; assets stay referenced, never opened here."""
    artifact = DesignArtifact.model_validate_json(artifact.model_dump_json())
    stage = artifact.payload.kind
    view_kind = {
        'requirements': 'documents', 'appearance': 'image_gallery', 'hardware_selection': 'hardware_table',
        'spatial_layout': 'spatial_scene', 'logical_layout': 'circuit_graph',
        'enclosure_detail': 'cad_components', 'motion_detail': 'motion_graph',
        'assembly_detail': 'assembly_scene', 'print_optimization': 'print_scene',
    }[stage]
    return {'schema_version': '0.2.0-draft', 'view_kind': view_kind,
        'artifact_ref': artifact_ref(artifact).model_dump(mode='json'),
        'source_snapshot_id': artifact.source_snapshot_id,
        'data': artifact.payload.model_dump(mode='json'), 'validation': artifact.validation}


class WorkflowProcess(DesignProcess):
    actions = ('prepare', 'submit', 'generate')
    result_model, output_model = WorkflowResult, WorkflowOutput

    def describe(self):
        base = super().describe()
        _, _, required, optional, keys = self.spec
        return base.model_copy(update=dict(category='workflow', required_upstream=required,
            optional_upstream=optional, context_keys=keys,
            limitations=('Generation has no registered executor.',
                'prepare assembles context; submit accepts authored data without persisting or approving it.',
                'Engine simulation requires explicit integration into a design snapshot.')))

    def _inspect(self, r, ctx, resolved):
        x, items = r.input, []
        required, optional = self.spec[2:4]
        for stage in required:
            if stage not in x.upstream:
                items.append(need('upstream.' + stage, 'Provide a pinned ' + stage + ' artifact'))
        if set(x.upstream) - set(required + optional):
            items.append(need('upstream', 'Unexpected upstream stages', state='conflict'))
        if self.kind == 'requirements' and not x.source_documents:
            items.append(need('source_documents', 'Provide the source documents'))
        if self.kind == 'hardware_selection' and not r.base.design.elements and ctx.elements is None:
            items.append(need('elements', 'Provide embedded library definitions or a read-only library reader', 'element'))
        if self.kind != 'requirements' and x.source_documents:
            items.append(need('source_documents', 'Documents must come from pinned upstream artifacts', state='conflict'))
        if self.kind == 'print_optimization' and x.printer is None:
            items.append(need('printer', 'Specify build volume, process, minimum feature, resolution and overhang limit'))
        if x.action == 'generate':
            items.append(need('executor', 'No generation backend is connected', 'executor', 'unsupported'))
        if r.requested_checks:
            items.append(need('requested_checks', 'Integrate the artifact into a design before engine simulation', 'executor', 'unsupported'))
        if x.action == 'submit' and x.deliverable is None:
            items.append(need('deliverable', 'Submit an explicitly authored output'))
        if x.action != 'submit' and x.deliverable is not None:
            items.append(need('deliverable', 'Authored output is accepted by submit only', state='conflict'))
        try:
            upstream, by_id = _closure(r)
            if x.previous:
                previous = by_id.get(x.previous.artifact_id)
                if previous is None or artifact_ref(previous) != x.previous or previous.payload.kind != self.kind or previous.design_id != r.base.design.manifest.design_id:
                    raise ValueError('Previous artifact pin is unavailable or mismatched')
            elif x.action == 'submit' and x.artifact_id in by_id:
                raise ValueError('Artifact ID already exists; submit a new revision')
        except KeyError:
            return items + [need('artifacts', 'Provide the complete upstream artifact closure')]
        except ValueError:
            return items + [need('artifacts', 'Artifact pins, dependency revisions or design snapshot conflict', state='conflict')]
        definitions = {}
        selection = upstream.get('hardware_selection')
        choices = x.deliverable if self.kind == 'hardware_selection' else selection.payload if selection else None
        if choices:
            for choice in choices.choices:
                try:
                    definition = ctx.element(r.base.design, choice.element_ref)
                    definitions[choice.selection_record_id] = definition
                except (ValueError, KeyError):
                    items.append(need('elements', 'Pinned hardware must exist in the supplied library or design', 'element'))
        if x.action == 'submit' and x.deliverable is not None and not items:
            try:
                items.extend(self._inspect_deliverable(r, upstream, definitions))
            except (ValueError, KeyError):
                items.append(need('deliverable', 'Conflicting native hardware definitions or references', state='conflict'))
        return items

    def _inspect_deliverable(self, r, upstream, definitions):
        data, items = r.input.deliverable, []
        selection = upstream.get('hardware_selection')
        instances = _instances(selection.payload) if selection else {}
        # Native occurrence refs are deterministic and remain owned by engine/element.
        from engine.design import resolve_design
        native = {}
        if selection:
            from engine.design import make_package
            from engine.design.contracts import SelectionData, Candidate, DiscreteUsage, Instance
            records = []
            for choice in selection.payload.choices:
                records.append(dict(record_kind='design_record', design_id=r.base.design.manifest.design_id,
                    record_id=choice.selection_record_id, kind='selection', title=choice.selection_record_id,
                    data=SelectionData(candidates={'chosen': Candidate(element_ref=choice.element_ref)},
                        chosen_candidate_id='chosen', usage=DiscreteUsage(planned_count=len(choice.instances),
                            instances={i: Instance(label=i) for i in choice.instances})).model_dump(mode='json')))
            package = make_package(design_id=r.base.design.manifest.design_id, title='Workflow context',
                records=records, elements=tuple({c.element_ref: definitions[c.selection_record_id]
                    for c in selection.payload.choices}.values()))
            native = resolve_design(package).objects
        conflict = lambda key, message: need(key, message, state='conflict')
        if self.kind == 'spatial_layout':
            keys = [p.instance_ref.key() for p in data.placements]
            if len(keys) != len(set(keys)) or set(keys) != set(instances):
                items.append(conflict('placements', 'Place each selected hardware instance exactly once'))
        elif self.kind == 'logical_layout':
            from engine.design.contracts import Terminal
            used = []
            for net in data.nets.values():
                if len(net.members) < 2:
                    items.append(conflict('nets', 'A net requires at least two explicit terminals'))
                used.extend(ref.key() for ref in net.members)
                if net.reference_net is not None and (net.reference_net.collection != 'nets' or
                        net.reference_net.record_id != r.input.artifact_id or net.reference_net.object_id not in data.nets):
                    items.append(conflict('nets', 'Reference net must resolve inside this logical layout artifact'))
            unconnected = [ref.key() for ref in data.unconnected_terminals]
            terminals = {key for key, value in native.items() if isinstance(value, Terminal)}
            if len(used + unconnected) != len(set(used + unconnected)) or set(used + unconnected) != terminals:
                items.append(conflict('nets', 'Every hardware terminal must belong to one net or be explicitly unconnected'))
        elif self.kind == 'motion_detail':
            from engine.design.contracts import Body
            bodies = {k for k, v in native.items() if isinstance(v, Body)}
            for joint in data.joints.values():
                if joint.parent_body.key() not in bodies or joint.child_body.key() not in bodies or joint.parent_body == joint.child_body:
                    items.append(conflict('joints', 'Motion must connect two distinct selected hardware bodies'))
        elif self.kind == 'assembly_detail':
            original = {c.component_id for c in upstream['enclosure_detail'].payload.components}
            updated = {c.component_id for c in data.components}
            if not original <= updated:
                items.append(conflict('components', 'Refinement must retain every source enclosure component ID'))
            subjects = set(instances) | updated
            relations = set()
            motion = upstream.get('motion_detail')
            for relation in data.relations:
                if relation.relation_id in relations or relation.parent not in subjects or relation.child not in subjects:
                    items.append(conflict('relations', 'Duplicate relation ID or unavailable assembly subject'))
                relations.add(relation.relation_id)
                if relation.joint_id and (not motion or relation.joint_id not in motion.payload.joints):
                    items.append(conflict('relations', 'Joint relationship requires a pinned motion artifact and joint'))
            for connection in data.engineering_connections:
                from engine.design.contracts import Mount
                if not isinstance(native.get(connection.a.key()), Mount) or not isinstance(native.get(connection.b.key()), Mount):
                    items.append(conflict('engineering_connections', 'Native mount references must resolve against selected hardware'))
                if connection.kind == 'joint' and (connection.joint_ref is None or not motion or
                        connection.joint_ref.record_id != motion.artifact_id or
                        connection.joint_ref.collection != 'joints' or connection.joint_ref.object_id not in motion.payload.joints):
                    items.append(conflict('engineering_connections', 'Joint connection requires a pinned motion joint'))
        elif self.kind == 'print_optimization':
            originals = {c.component_id for c in upstream['assembly_detail'].payload.components}
            sources = [p.source_component_id for p in data.parts]
            outputs = [p.optimized.component_id for p in data.parts]
            if set(sources) != originals or len(outputs) != len(set(outputs)):
                items.append(conflict('parts', 'Cover every assembled component and use unique optimized component IDs'))
        return items

    def _run(self, r, ctx):
        x = r.input
        upstream, _ = _closure(r)
        selection = upstream.get('hardware_selection')
        choices = x.deliverable if self.kind == 'hardware_selection' else selection.payload if selection else None
        definitions = tuple(dict.fromkeys(c.element_ref for c in choices.choices)) if choices else ()
        context = ContextPack(upstream=tuple(upstream.values()), source_documents=x.source_documents,
            elements=(tuple(ctx.element(r.base.design, ref) for ref in definitions) if choices else
                r.base.design.elements if self.kind == 'hardware_selection' else ()),
            library_search_available=ctx.elements is not None,
            constraints=x.constraints, printer=x.printer)
        artifact = None
        if x.action == 'submit':
            artifact = DesignArtifact(design_id=r.base.design.manifest.design_id,
                artifact_id=x.artifact_id, revision=x.revision, source_snapshot_id=r.base.snapshot_id,
                previous=x.previous,
                dependencies=x.upstream, source_documents=x.source_documents, constraints=x.constraints,
                printer=x.printer, payload=x.deliverable)
        return self.finish(r, ctx, WorkflowOutput(context=context, artifact=artifact,
            view=project_artifact(artifact) if artifact else {}))
