"""Bounded, read-only expansion of native units. No filesystem or engine dependency."""
from dataclasses import dataclass
from types import MappingProxyType
import json
from element.schema.professional import DomainRef, OccurrenceRef, InlineUnit, ElementDefinitionV2
from element.io.records import element_ref


def pointer(*parts):
    return '/' + '/'.join(str(p).replace('~', '~0').replace('/', '~1') for p in parts)


@dataclass(frozen=True)
class UnitOccurrence:
    definition: object
    element_ref: object
    location: object
    pointer: str = ''
    parameter_bindings: object = None


class Composition:
    def __init__(self, instances, definitions):
        self.nodes = {}
        self.definitions = definitions

        def expand(scope, definition, pin, location, prefix='', ancestors=(), bindings=None):
            if len(scope) > 17 or len(self.nodes) >= 256:
                raise ValueError('Composition depth/occurrence budget exceeded')
            self.nodes[scope] = UnitOccurrence(definition, pin, location, prefix, bindings or {})
            for name, child in definition.units.items():
                if isinstance(child, InlineUnit):
                    expand((*scope, name), child.definition, pin, location,
                           prefix + pointer('units', name, 'definition'), ancestors)
                else:
                    key = child.element_ref.content_hash
                    if key in ancestors: raise ValueError('Element dependency cycle')
                    target = definitions.get(key)
                    if target is None or element_ref(target) != child.element_ref:
                        raise ValueError('Child element pin unavailable or differs: ' + '/'.join((*scope, name)))
                    for param, value in child.parameter_bindings.items():
                        spec = target.parameters.get(param)
                        if not spec or not spec.get('configurable', False):
                            raise ValueError('Child parameter is readonly: ' + param)
                        if set(value) != {'value'}: raise ValueError('Parameter binding supports value only')
                        from element.base.quantity import Parameter
                        bound = Parameter.model_validate_json(json.dumps({**spec, 'value': value['value']}))
                        declared = Parameter.model_validate_json(json.dumps(spec))
                        if declared.value and bound.value.dimension != declared.value.dimension:
                            raise ValueError('Child parameter binding has incompatible dimensions')
                    if child.parameter_bindings:
                        data = target.model_dump(mode='json')
                        for param, value in child.parameter_bindings.items(): data['parameters'][param]['value'] = value['value']
                        target = ElementDefinitionV2.model_validate_json(json.dumps(data))
                    expand((*scope, name), target, child.element_ref, child.location,
                           '', (*ancestors, key), child.parameter_bindings)
        for name, instance in instances.items():
            target = definitions.get(instance.element_ref.content_hash)
            if target is None or element_ref(target) != instance.element_ref:
                raise ValueError('Element pin unavailable or differs: ' + name)
            expand((name,), target, instance.element_ref, instance.location,
                   ancestors=(instance.element_ref.content_hash,))
        self.validate()
        self.nodes = MappingProxyType(self.nodes)

    def resolve(self, scope, ref, public=False, trail=()):
        """Return a canonical occurrence reference. Export aliases never duplicate objects."""
        if isinstance(ref, dict): ref = DomainRef.model_validate_json(json.dumps(ref))
        node = self.nodes.get(scope)
        if node is None: raise ValueError('Unresolved unit path: ' + '/'.join(scope))
        signature = (scope, ref.domain, ref.collection, ref.id, ref.unit_path, public)
        if signature in trail: raise ValueError('Export reference cycle')
        trail = (*trail, signature)
        d = node.definition
        if public and isinstance(d, ElementDefinitionV2) and d.schema_version == '2.0.0-draft':
            public = False  # v2 has no visibility boundary; retain its published interface.
        if public:
            if ref.unit_path:
                candidate = self.resolve(scope, ref, trail=trail)
                targets = d.exports.get(ref.domain, {}).get(ref.collection, {})
                if any(self.resolve(scope, target, trail=trail) == candidate for target in targets.values()):
                    return candidate
                raise ValueError('Private object; use exported interfaces at unit boundaries')
            target = d.exports.get(ref.domain, {}).get(ref.collection, {}).get(ref.id)
            if target is None: raise ValueError('Private or unknown exported object: ' + ref.id)
            return self.resolve(scope, target, trail=trail)
        if ref.unit_path:
            child, *rest = ref.unit_path
            if child not in d.units: raise ValueError('Unknown child unit: ' + child)
            data = ref.model_dump(mode='json')
            data['unit_path'] = rest
            return self.resolve((*scope, child), DomainRef.model_validate_json(json.dumps(data)), public=True, trail=trail)
        collection = getattr(getattr(d, ref.domain, None), ref.collection, None)
        if collection is None and ref.domain == 'flow': collection = d.flow.get(ref.collection)
        if collection is None or ref.id not in collection:
            raise ValueError('Unresolved scoped object: ' + '/'.join((*scope, ref.collection, ref.id)))
        return OccurrenceRef(instance=scope[0], unit_path=scope[1:], domain=ref.domain, collection=ref.collection, id=ref.id)

    def project_ref(self, ref):
        # Project authoring uses a top-level element's public aliases.
        return self.resolve((ref.instance,), DomainRef.model_validate_json(json.dumps(
            {k:v for k,v in ref.model_dump(mode='json').items() if k != 'instance'})), public=True)

    def validate(self):
        for scope, node in self.nodes.items():
            d = node.definition
            if d.bom.policy == 'children' and (not d.units or d.mechanical.links or d.procurement or d.manufacturing):
                raise ValueError('Expanded BOM requires children and no unaccounted local deliverable')
            for domain, collections in d.exports.items():
                for collection, aliases in collections.items():
                    for alias, target in aliases.items():
                        if (target.domain, target.collection) != (domain, collection):
                            raise ValueError('Export domain/collection mismatch')
                        self.resolve(scope, target)
            for joint in d.mechanical.joints.values():
                for ref in (joint.parent, joint.child): self.resolve(scope, ref)
            for net in d.electrical.nets.values():
                for ref in net.nodes:
                    if (ref.domain, ref.collection) != ('electrical', 'pins'):
                        raise ValueError('Internal net endpoints must be electrical pins')
                    self.resolve(scope, ref)
            for mount in d.mechanical.mount_connections.values():
                for end in ('a', 'b'):
                    ref = DomainRef.model_validate_json(json.dumps(mount[end]))
                    if (ref.domain, ref.collection) != ('mechanical', 'mounts'):
                        raise ValueError('Mount connection endpoints must be mounts')
                    self.resolve(scope, ref)
            # Untyped cross-unit models cannot silently claim execution support.
            if d.units and (d.behavior.bindings or d.flow):
                raise ValueError('Composite flow/behavior bindings require an explicit typed adapter')
