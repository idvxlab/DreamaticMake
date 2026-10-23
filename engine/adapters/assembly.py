"""Compose category designs using existing versioned assembly/connection contracts."""
from collections.abc import Mapping
from element.base.identity import DefinitionRef
from element.categories.base import ComponentDesign
from engine.schema.component import ComponentDefinition
from engine.schema.assembly import AssemblyDefinition, ComponentInstance, Connections, ModelBundle
from element.io.save import content_hash


def assemble_components(*, id: str, name: str,
                        components: Mapping[str, ComponentDesign | ComponentDefinition],
                        connections: Connections | None = None) -> ModelBundle:
    if not components:
        raise ValueError("An assembly requires at least one component")
    definitions, instances = {}, {}
    for instance_id, source in components.items():
        from engine.adapters.elements import to_definition
        definition = to_definition(source) if isinstance(source, ComponentDesign) else source
        definition = ComponentDefinition.model_validate_json(definition.model_dump_json())
        key = (definition.id, definition.revision)
        if key in definitions and content_hash(definitions[key]) != content_hash(definition):
            raise ValueError("Conflicting contents for the same definition ID and revision")
        definitions[key] = definition
        instances[instance_id] = ComponentInstance(definition_ref=DefinitionRef(
            id=definition.id, revision=definition.revision, content_hash=content_hash(definition)))
    assembly = AssemblyDefinition(id=id, name=name, instances=instances,
                                  connections=connections or Connections())
    return ModelBundle(components=tuple(definitions.values()), assemblies=(assembly,), root=DefinitionRef(
        id=assembly.id, revision=assembly.revision, content_hash=content_hash(assembly)))
