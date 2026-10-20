from engine.base.contract import Contract, Id, Revision, Sha256


class DefinitionRef(Contract):
    id: Id
    revision: Revision
    content_hash: Sha256
