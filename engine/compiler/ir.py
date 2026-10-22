from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping
from engine.base.contract import Contract
from engine.base.diagnostic import Diagnostic
from engine.interface.motion import Joint, Transmission
from engine.interface.electrical import ElectricalNet
from engine.schema.assembly import ModelBundle
from engine.schema.component import ComponentDefinition


@dataclass(frozen=True)
class BoundObject:
    key: str
    scope: tuple[str, ...]
    spec: Contract


@dataclass(frozen=True)
class BoundJoint:
    key: str
    parent: str
    child: str
    spec: Joint


@dataclass(frozen=True)
class BoundTransmission:
    key: str
    driver: str
    follower: str
    spec: Transmission


@dataclass(frozen=True)
class BoundNet:
    key: str
    members: tuple[str, ...]
    spec: ElectricalNet


@dataclass(frozen=True)
class SimulationIR:
    snapshot_id: str
    canonical_snapshot: str
    objects: Mapping[str, BoundObject]
    components: Mapping[tuple[str, ...], ComponentDefinition]
    joints: Mapping[str, BoundJoint]
    joint_order: tuple[str, ...]
    transmissions: tuple[BoundTransmission, ...]
    roots: tuple[str, ...]
    nets: Mapping[str, BoundNet]
    terminal_nets: Mapping[str, str]
    aliases: Mapping[str, str]
    input_revisions: Mapping[str, int]
    diagnostics: tuple[Diagnostic, ...]

    def resolve(self, ref, scope=()):
        key = ref.key(scope)
        return self.aliases.get(key, key)

    def collection(self, collection: str):
        return {key: obj for key, obj in self.objects.items()
                if key.rsplit("/", 2)[-2] == collection}
