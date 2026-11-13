# DreamaticMaker multi-agent protocol

Pi-compatible role manifests live in `.pi/agents`. The host loads exactly one author role per stage and
uses Codex app-server as the execution harness. A role manifest defines product behavior; it never grants
filesystem, approval or network authority.

The project coordinator owns user intent and stage routing. Specialist roles author only their assigned
artifact. The independent reviewer receives a frozen artifact revision and cannot edit it. Only the local
application approval route may advance a reviewed revision.

All roles preserve units, sources, assumptions, unknowns and artifact pins. Tool output is evidence only
when the tool was actually executed and the result was read back. Geometry, firmware and simulation claims
must carry corresponding execution evidence.
