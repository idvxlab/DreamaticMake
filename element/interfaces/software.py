"""Project-owned software links; source code is never executed by the element DSL."""
from typing import Literal
from pydantic import Field, field_validator
from element.base.contract import Contract


def software_path(value: str) -> str:
    parts = value.split('/')
    if (len(parts) < 2 or parts[0] != 'software' or
            any(not p or p in ('.', '..') or p.startswith('.') or p.endswith((' ', '.')) for p in parts) or
            any(c in value for c in '\\:*?"<>|\x00') or any(ord(c) < 32 for c in value)):
        raise ValueError('Software path must be a project-relative file/folder under software/')
    return value


class SoftwareProject(Contract):
    schema_version: Literal['1'] = '1'
    relative_path: str | None = Field(default=None, max_length=1024)
    language: str | None = Field(default=None, max_length=100)
    entrypoint: str | None = Field(default=None, max_length=256)

    @field_validator('relative_path')
    @classmethod
    def confined_path(cls, value):
        return software_path(value) if value else value
