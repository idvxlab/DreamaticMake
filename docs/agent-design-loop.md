# Agent design loop

The existing eight roles and stage order remain. Roles now hand off a versioned engineering model rather than treating a BOM, a layout description and a CAD file as independent results.

| Owner | Responsibility | Handoff |
| --- | --- | --- |
| hardware-engineer | Search the project catalog first; use configured network sources only for missing or unsuitable candidates. Select against requirements. | Exact part IDs and `hardwareFeatures`: selection reason, catalog envelope in mm, mounting, access/keepout and motion needs, evidence and unknowns. An exact revision can carry an `engineComponent`. |
| mechanical-engineer | Compose existing component contracts, connections and placements in the engine. | `engineDesign` v1: editable source, compiled bundle, pinned scenario, part-to-instance bindings, CAD constraints and executable goal checks. |
| cad-engineer | Consume the confirmed layout and constraints; generate custom geometry with available CAD tools. | Actual CAD artifacts, imported structure meshes and an updated assembly preserving hardware layout. |
| firmware-engineer | Implement software behavior and interfaces in source code; build using the available toolchain. | Source/build artifacts and corresponding declarative behaviors and scenario checks. |
| reviewer | Execute engine scenarios and assess requirement coverage, diagnostics and execution evidence. | Version-bound verification artifact and independent review; approval remains exclusively on application routes. |

## Agent tools

- `engine_schema(kind)`: reads strict Python schemas for `assembly_design`, `component_design` or `scenario`.
- `engine_library(query)`: exposes selected hardware features and bounded searches over committed category templates. Templates are explicitly synthetic, not verified commercial hardware.
- `engine_layout({source, scenario, bindings, constraints, checks})`: composes an `assembly_design`; Python calculates definition hashes and the scenario snapshot. Omit `scenario.snapshot_id`. The prepared design is attached to the next stage submission, rather than accepting model-invented compiled snapshots.
- `engine_cad_import()`: verifies current CAD artifact hashes, imports actual `base.stl` and `lid.stl` as project meshes and returns structure definitions to merge through `engine_layout`.
- `engine_verify()`: runs the submitted design through the same bounded Python adapter used by the workbench. Available only to the independent reviewer, with runtime-bound project/stage/revision.

The runtime and workbench share engine concurrency and cancellation controls. Browser requests still cannot execute while a project agent is running. Agent verification cannot mutate a design or write an approval. Layout edits during execution prevent publishing evidence.

The Python `request` protocol additionally supports `schema` and `compose`. `compose` takes an `AssemblyDesign` with inline category/standard component definitions, connections, joints and transmissions plus an unpinned scenario. It performs no filesystem discovery, scripting or network calls. Existing bundles and their DSL version are unchanged.

## Goal checks and freshness

Every layout retains a `collision_free` check. A `sample` check names a requirement, output collection, stable object reference, exact recorded time, expected value and optional numeric tolerance. Unknown/invalid samples and absent times fail rather than becoming zero or being interpolated. Reviewers must also assess whether checks cover the requirements; an empty function model with only a collision check does not prove product behavior.

Structural and later stages cannot pass independent review without current engine execution evidence. The server re-evaluates the recorded result and compares design hashes, bundles, scenarios and snapshots at review and approval. Failed/unsupported execution, relevant unknown diagnostics, collisions or unmet checks block passage. Category design-contract notices remain visible limitations rather than executable-performance claims.

Verification artifacts are derived outputs and excluded from their own input fingerprint. All other stage artifacts retain their existing hash behavior. Changing a goal, model or upstream input invalidates its review. Existing projects without engine models must produce a layout and verification before new structural-or-later approvals.

Downstream stages preserve selected hardware, existing placements, connections, constraints and goal checks. CAD can add generated structure components. Software can update declarative control functions/behaviors and source references; it cannot change physical contracts. Repairs requiring upstream changes use the existing reopen/revise flow and user confirmation.

## Current execution boundaries

CAD construction remains the trusted parameterized enclosure template (base, lid, openings and standoffs). Broader custom printable parts remain the CAD role's responsibility but require an implemented geometry executor before they can be delivered. Imported meshes require the optional mesh stack and retain original coordinates. The lid print orientation must be inverted for assembly; tools provide this instruction explicitly.

Software builds remain Pico Arduino C++. Engine behavior validation does not execute or establish equivalence of the generated source code. Compilation, model behavior and real device operation are separate evidence. Unsupported solvers and missing measurements stay explicit. Discrete envelope overlap does not certify manufactured interference or fit; intended contact can require additional geometric evidence and model refinement.

Run the application check/test/build scripts and Python tests. With `MAKE_ENGINE_TEST_PYTHON` pointing at the engine environment, `tests/agent-engine.test.ts` exercises real compose → simulation → evidence → independent review, stale proof rejection and downstream contract protection. `MAKE_ENGINE_TEST_MESH=1` enables the existing real STL regressions.
