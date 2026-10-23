from dataclasses import dataclass, field
from element.base.diagnostic import Diagnostic, ModelError
from element.base.reference import ObjectRef
from element.io.save import content_hash
from engine.schema.assembly import ModelBundle
from engine.schema.component import ComponentDefinition
from engine.compiler.ir import BoundObject


def error(code, message, *refs):
    return Diagnostic(code=code, message=message, object_refs=tuple(refs), severity="error", outcome="fail")


def component_collections(c):
    return {
        "bodies": c.physical.geometry.bodies, "envelopes": c.physical.geometry.envelopes,
        "visual_assets": c.physical.geometry.visual_assets,
        "joints": c.physical.motion.joints, "mechanical_ports": c.physical.mechanical.ports,
        "material_ports": c.physical.material.ports, "material_paths": c.physical.material.paths,
        "terminals": c.electronic.electrical.terminals, "interfaces": c.electronic.interfaces,
        "sensors": c.electronic.sensors, "effects": c.electronic.effects, "behaviors": c.behaviors,
    }


@dataclass
class Resolved:
    objects: dict = field(default_factory=dict)
    components: dict = field(default_factory=dict)
    assemblies: dict = field(default_factory=dict)
    aliases: dict = field(default_factory=dict)

    def ref(self, ref: ObjectRef, scope=()):
        key = ref.key(scope)
        return self.aliases.get(key, key)


def resolve(bundle: ModelBundle) -> Resolved:
    definitions = {}
    for definition in (*bundle.components, *bundle.assemblies):
        key = (definition.id, definition.revision)
        if key in definitions:
            raise ModelError([error("definition.duplicate", "Duplicate definition revision", definition.id)])
        definitions[key] = definition
    resolved = Resolved()
    count = 0

    def expand(ref, scope, ancestors, bindings=None):
        nonlocal count
        count += 1
        if count > 1000 or len(scope) > 32:
            raise ModelError([error("model.limit", "Instance expansion limit exceeded")])
        key = (ref.id, ref.revision)
        definition = definitions.get(key)
        if definition is None or content_hash(definition) != ref.content_hash:
            raise ModelError([error("definition.mismatch", "Missing definition or content hash mismatch", ref.id)])
        if key in ancestors:
            raise ModelError([error("assembly.cycle", "Recursive assembly definition", ref.id)])
        parameters = dict(definition.parameters)
        for name, value in (bindings or {}).items():
            original = parameters.get(name)
            if original is None or not original.configurable:
                raise ModelError([error("parameter.readonly", "Parameter is absent or not configurable", name)])
            if value.value and original.value and value.value.dimension != original.value.dimension:
                raise ModelError([error("parameter.dimension", "Parameter dimension changed", name)])
            if value.value and original.range and not original.range.contains(value.value):
                raise ModelError([error("parameter.range", "Binding exceeds definition range", name)])
            parameters[name] = type(value).model_validate({**value.model_dump(), "configurable": original.configurable, "range": original.range})
        definition = type(definition).model_validate({**definition.model_dump(), "parameters": parameters})
        if isinstance(definition, ComponentDefinition):
            resolved.components[scope] = definition
            for collection, objects in component_collections(definition).items():
                for name, spec in objects.items():
                    obj_key = ObjectRef(collection=collection, object_id=name).key(scope)
                    resolved.objects[obj_key] = BoundObject(obj_key, scope, spec)
        else:
            resolved.assemblies[scope] = definition
            for name, instance in sorted(definition.instances.items()):
                expand(instance.definition_ref, (*scope, name), (*ancestors, key), instance.parameter_bindings)
            for name, joint in definition.joints.items():
                obj_key = ObjectRef(collection="joints", object_id=name).key(scope)
                resolved.objects[obj_key] = BoundObject(obj_key, scope, joint)
            for name, target in definition.exported_ports.items():
                if not target.instance_path:
                    raise ModelError([error("export.scope", "Exports must refer to descendants", name)])
                alias = ObjectRef(collection=target.collection, object_id=name).key(scope)
                dest = resolved.ref(target, scope)
                if alias in resolved.objects or dest not in resolved.objects:
                    raise ModelError([error("export.invalid", "Invalid or shadowing exported port", alias)])
                resolved.aliases[alias] = dest

    expand(bundle.root, (), ())
    if len(resolved.objects) > 5000:
        raise ModelError([error("model.limit", "Expanded object limit exceeded")])
    return resolved
