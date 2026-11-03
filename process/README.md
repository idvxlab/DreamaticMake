# Design processes — 0.1.0-draft

`element/` defines reusable objects. `engine/` defines designs and performs parsing, projection and checks. This top-level `process/` package describes the information needed for a design operation and produces typed results and reviewable changes to those existing objects.

The dependency direction is `process → engine → element`, with direct read access from process to element. No agent runtime, approval decision or project-storage writer is included.

## Implemented classes

Each module exports an `Input`, `Output`, `Request`, `Result` and a process class with `describe()`, `inspect(request, context)` and `run(request, context)`.

| Class | Implemented operations | Explicit limits |
| --- | --- | --- |
| `SelectionProcess` | Library search, pinned candidate comparison, choose/replace into a selection record | No automatic commercial selection; unknown/assumed requirements remain unknown |
| `PlacementProcess` | Explicit discrete-instance poses in world coordinates or relative to a placed body | No automatic layout; conflicting existing body pose overrides must be reconciled |
| `ConnectionProcess` | Explicit mechanical mounts, electrical nets, external material/information edges, energy transfers and required paths | Does not infer holes or interfaces; preserves intrinsic element topology |
| `MotionProcess` | Cross-element joints/transmissions/drives and explicit moving-joint initial values | No inverse kinematics; inherited-address changes with existing references need explicit reconciliation |
| `MechanicalDetailProcess` | Snapshot-bound material/subject information; integrate an authored `CADHousing` as a new pinned selection and instance | No general CAD generator, attachment solver, fit/strength/manufacturing check |
| `CircuitDetailProcess` | Explicit wiring nets using the same connection helpers | No EDA/analog/ERC/PCB generation or verification backend |
| `LogicDetailProcess` | Typed logic authoring/binding using `LogicData`, including inert code or firmware references | Saves source without execution; no Python sandbox or firmware compiler |

This is the first executable subset of the plan in `agent/代码计划/设计流程工具适配与输入输出接口.md`. Its schemas are exported from the actual models. Some planned actions and fields are deliberately not accepted yet; the returned JSON Schema, rather than a future plan, defines what this implementation accepts.

## Python usage

```python
from element.io.components import load_component
from element.schema.library import ElementDefinition
from element.io.records import element_ref
from engine.design import make_package, project_design
from engine.design.contracts import DiscreteUsage, Instance
from process import (
    SelectionProcess, SelectionRequest, SelectionInput, build_candidate,
)

model = load_component("examples/element/gripper.json")
definition = ElementDefinition(
    library_id="examples", element_id=model.id, revision=model.revision,
    name=model.name, category=model.category, origin="template", model=model,
)
design = make_package(design_id="demo", title="Demo", elements=(definition,))
request = SelectionRequest.for_design(
    design,
    input=SelectionInput(
        action="choose", chosen_ref=element_ref(definition),
        usage=DiscreteUsage(planned_count=1, instances={"gripper": Instance(label="Gripper")}),
    ),
    write_record_ids=("selection",),
)
process = SelectionProcess()
needs = process.inspect(request)
result = process.run(request)
if result.status == "completed" and result.proposals:
    candidate = build_candidate(
        design, result.proposals[0], write_record_ids=request.scope.write_record_ids,
    )
    views = project_design(candidate)
```

Python constructors use immutable tuples and strict existing models; JSON requests use arrays. `Request.for_design()` fills the fixed snapshot and expected revision. Requests are revalidated before execution, including callers that used unchecked `model_copy()`.

`ProcessContext(elements=...)` can provide an `ElementLibrary` or compatible read-only reader. Exact pins may instead be embedded in `DesignPackage.elements`. Asset reads for actual engine checks require an injected resolver and an explicit request allowlist; bytes are checked against their SHA-256.

## Results and persistence

`inspect()` reports missing/conflicting information or unsupported operations without changing a design. `run()` returns `completed`, `needs_input`, `unsupported` or `failed`. Completed means the operation produced a result; inspect `checks`, their outcomes and coverage before interpreting engineering validity.

Mutation operations produce a `DesignProposal`, containing whole-record upserts and pinned definitions to embed. `build_candidate()` checks the baseline snapshot, write scope, previous record pin, revision increments and immutable element identity, then constructs a new `DesignPackage`. It does not persist it. Incomplete engineering references remain draft diagnostics, as in the engine authoring protocol.

Actual checks run on the candidate snapshot, not the baseline. All previous check results become stale with respect to that new snapshot. A host may explicitly commit the candidate with `DesignStore.commit(..., expected_manifest_revision=...)`; process code never silently writes the store or publishes definitions into a library. Two-phase library publication and host authorization remain host responsibilities.

## CLI and examples

```powershell
.\python.cmd -m process list
.\python.cmd -m process schema selection
.\python.cmd -m examples.process.housing_pipeline
.\python.cmd -m examples.process.housing_pipeline --request | .\python.cmd -m process request
```

The CLI reads one bounded JSON object from stdin and returns one JSON result. It dispatches only explicitly registered process kinds, never arbitrary modules or code. Status `completed` exits with 0; other process statuses and invalid input exit with 2. It does not open arbitrary library paths; embed pinned definitions for offline CLI use.

The housing example uses a real JSCAD-produced STL with explicit millimeter units and unknown physical material properties. Geometry execution and STL readback do not certify manufacturing or physical performance.

Run `npm test` for the TypeScript, element, engine and process suites. On this Windows checkout use `.\npm.cmd test`. The optional real mesh regression is skipped when its dependency is unavailable.
