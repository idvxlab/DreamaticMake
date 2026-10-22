from pathlib import PurePosixPath
from typing import Literal
from pydantic import model_validator
from engine.base.contract import Contract, Id, Sha256

Collection = Literal["bodies", "joints", "envelopes", "visual_assets", "mechanical_ports", "terminals",
                     "interfaces", "sensors", "effects", "behaviors", "material_ports", "material_paths"]


class ObjectRef(Contract):
    instance_path: tuple[Id, ...] = ()
    collection: Collection
    object_id: Id

    def key(self, prefix: tuple[str, ...] = ()) -> str:
        return "/".join((*prefix, *self.instance_path, self.collection, self.object_id))


class AssetRef(Contract):
    artifact_id: str | None = None
    relative_path: str | None = None
    sha256: Sha256
    media_type: str

    @model_validator(mode="after")
    def location(self):
        if bool(self.artifact_id) == bool(self.relative_path):
            raise ValueError("Choose exactly one asset location")
        if self.relative_path:
            path = PurePosixPath(self.relative_path)
            if path.is_absolute() or ".." in path.parts or ":" in self.relative_path or "\\" in self.relative_path:
                raise ValueError("Asset paths must be confined POSIX relative paths")
        return self
