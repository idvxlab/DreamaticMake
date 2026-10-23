# Product Design Engine — 0.5.0

This Python package implements the executable core of the product DSL v2 proposal (`0.2.0-proposal`). It is an offline library and CLI, independent of the existing Node.js server. It never reads `.env`, invokes a model provider, updates Design Context, purchases components, or executes code from a DSL record.

**The sample models are synthetic assumptions. Successful simulation is not physical validation.** The package remains usable independently of the Node.js application. The web workbench now invokes its CLI through the [server adapter](../docs/design-engine-integration.md), keeping Context authoritative. A model bundle is an immutable snapshot input, not another canonical BOM.

## Element/design separation (0.5.0)

Reusable component contracts now live in [`element/`](../element/README.md), with 14 authoring categories, pinned library definitions and a rebuildable local search index. `engine` owns design-level composition, projection, checking and execution. New [`engine.design`](design/README.md) contracts cover analysis documents, function cards, selection, structure, motion, circuit/energy, material/information flow and logic.

Python callers now import reusable contracts directly from `element.categories`, `element.base` and `element.interfaces`; the old engine forwarding modules and compatibility subclasses have been removed. Conversion and scenario commands live in `engine.adapters`; cross-instance relationships live in `engine.schema.connections`. Existing bundles, layouts and their hashes retain their original contracts. New library/design records have separate versioned hashes. Normalized execution containers live in `engine.schema.component`; reusable metadata lives in `element.schema.definition`. The identity-only migration wrapper and layout-to-design copying API have been removed.

Use `python -m element schema element_definition` and `python -m engine schema design_package` to inspect the new contracts. New design operations are available through Python and inline CLI requests. The existing web workbench keeps its current layout API.

## Install and run

Requires Python 3.11+ and Pydantic 2.x. Run from the repository root, preferably in a virtual environment:

```bash
python -m venv .venv
# Activate the environment using your platform's usual command.
python -m pip install "pydantic>=2,<3"
python -B -m unittest discover -s engine/tests -v

python -m engine validate engine/examples/actuator.bundle.json
python -m engine simulate engine/examples/actuator.bundle.json --scenario engine/examples/actuator.scenario.json
python -m engine simulate engine/examples/fan.bundle.json --scenario engine/examples/fan.scenario.json
python -m engine simulate engine/examples/lamp.bundle.json --scenario engine/examples/lamp.scenario.json
```

The CLI entry point is `python -m engine`; this repository does not currently define an installed console command. All test cases are offline and use `unittest`; no paid models or network calls are involved. Installation may fetch the declared Python dependencies.

The examples cover:

| Example | Actual computation | Important limitation |
| --- | --- | --- |
| Actuator and rigid link | A pulse-width fixture maps to a target angle; an ideal supply gates output; velocity-limited positioning drives a fixed-mounted link | Pulse width is an abstract scalar fixture, not a wire-level PWM waveform; no torque or backlash |
| Continuous fan | An angular-speed fixture drives continuous rotation; material inlet/outlet/path are retained | Material topology only; no calculated airflow |
| Temperature-triggered indicator | Celsius input converts to Kelvin, sampling and latency precede a threshold and digital light effect | No thermal solver, physical sensor noise, or illuminance calculation |

## Python API

### Editable design views (0.4.0)

`engine.layout` adds the versioned `layout_draft` contract, independent of full
executable-model validation. Syntactically valid but overlapping, disconnected or
unfinished layouts can be projected and saved. Checks are explicit operations:

```python
from engine.layout import dispatch_layout

draft = {"record_kind": "layout_draft", "layout_version": 1,
         "entities": {"controller": {"name": "Controller"}}}
scene = dispatch_layout("layout_project", {"draft": draft})
report = dispatch_layout("layout_collision", {"draft": draft})
assert report["check"]["status"] == "partial"  # No physical geometry yet.
```

The request protocol accepts `layout_project`, `layout_motion`,
`layout_collision`, `layout_connectivity`, and `layout_import`; use
`python -m engine schema layout_draft` for the contract. Projections share stable
object bindings across 3D, circuit/energy and combined material/information graphs.
Motion handles independent tree mechanisms, rotary ratios and screws; collision
checks report missing geometry and optional mesh support explicitly. Connectivity
does not solve currents, energy, flow or protocols.

The integrated workbench also provides local browser Python code cells with input
widgets and temporary preview bindings. Python execution belongs to the application
worker, not the DSL interpreter. See [design workspace](../docs/design-workspace.md)
for APIs, CAD mapping, persistence and current limitations. Legacy executable
contracts, immutable snapshots and verification remain available.

### Executable component API

For category-specific authoring, start with [the component design API](../element/categories/README.md)
and [16 common component examples](examples/components/README.md). `element.categories` provides
strict, immutable types for structure, transmission, actuators, light, displays, sound, human
input, sensors, controllers, drivers, power, transport and mechanical energy storage. Python
constructors, mappings, JSON and TOML all lower into the existing execution contracts; structure
also has an explicit STL import entry point. Existing bundles and their hashes are unchanged.

```python
from element.categories import Light
from element.interfaces.behavior import InputBinding
from engine.compiler.lower import compile_model

led = Light(id="status", name="Status LED",
            channels={"brightness": InputBinding(kind="constant", value=0.5)})
ir = compile_model(led)
from engine.adapters.elements import to_bundle
bundle = to_bundle(led)  # Use in the existing application/assembly contract.
```

```bash
python -m engine schema component_design
python -m engine compile engine/examples/components/indicator.toml
python -m engine simulate engine/examples/components/servo.json --scenario engine/examples/components/servo.scenario.json
python -m engine.examples.component_assembly
python -m engine.examples.import_structure
```

TOML requires Python 3.11+; the STL example requires the optional mesh stack. Control functions
are typed, named declarative behaviors, while firmware source references remain descriptive.
Design metadata (e.g. display resolution and energy capacity) is hash-pinned but does not add a
pixel renderer, energy solver or firmware execution. Save the original `component_design` for
editing: the lowered definition retains its provenance hash, not the complete source record.

Version 0.3.0 provides 14 authoring categories. Structure/transmission, actuators, light,
display, sound, sensors and power accept one optional typed `spec` description. These describe
mechanical standards, feedback/limits, addressable lights, display technology, speaker ratings,
IMU axes, camera/audio streams and battery ratings. Power additionally accepts optional wiring
with physical positive/ground pin poses. Absent extension fields are omitted on serialization,
preserving all existing example snapshot hashes. Source descriptions remain editable records;
lowered definitions retain their provenance and a `_description` capability marker.

The new `circuit_element` category describes resistors, capacitors, inductors, diodes,
transistors and phototransistor-output optocouplers through typed `spec` and `wiring` fields.
Semantic terminal names are checked separately from physical pin numbers. Circuit elements
emit `circuit.analysis_unavailable`; camera/audio stream descriptions emit
`sensor.stream_unavailable`, both with unsupported coverage. Geometry previews and terminal
projections remain available, but no analog conduction, image/audio samples or product acceptance
are inferred. The application reviewer rejects unsupported coverage. Existing scalar IMU fixtures
can execute with the new acceleration/magnetic units. Added protocol names are descriptive only.

See [typed descriptions and circuit parts](../element/categories/README.md#7-紧凑描述接口与基础电路器件)
and run `python -m engine.examples.described_components` to compile the synthetic templates.

```python
from engine.io.load import load
from engine.compiler.lower import compile_model
from engine.simulator.engine import simulate
from engine.projection.scene import project_scene
from engine.projection.circuit import project_circuit

bundle = load("engine/examples/actuator.bundle.json")
scenario = load("engine/examples/actuator.scenario.json")
ir = compile_model(bundle)
result = simulate(ir, scenario)
scene = project_scene(ir, result)
circuit = project_circuit(ir, result)
assert scene["snapshot_id"] == circuit["snapshot_id"]
```

`compile_model` raises `ModelError` with structured diagnostics for invalid engineering relationships. `simulate` returns `completed`, `failed`, `unsupported`, or `cancelled`, plus diagnostics and coverage. Schema violations raise Pydantic validation errors. Invalid JSON and unavailable files produce standard value/I/O errors. An unsuccessful run can retain earlier frames; `actual_end_s` identifies the last recorded time.

Read `diagnostics`, sample `quality`, and `coverage` even when status is `completed`: unknown inputs, missing geometry, and topology-only domains can coexist with a completed run. A collision report denotes overlap of the declared envelopes, not automatically proven physical interference. No aggregate product acceptance or physical-pass flag is produced.

## Layout

| Directory | Responsibility |
| --- | --- |
| `adapters/` | Lower reusable element definitions into execution models, compose assemblies and create scenario commands |
| `design/` | Eight-layer design records, references, storage, validation and projection |
| `schema/` | Cross-instance connections, assemblies, self-contained bundles, scenarios and simulation results |
| `io/` | Engine record dispatch, assembly inputs and JSON Schema export; shared parsing, serialization and assets use `element.io` |
| `compiler/` | Version/hash resolution, recursive instance expansion, aliases, semantic checks and read-only IR |
| `simulator/` | Kinematics, sampled collisions, four-state logic, built-in behaviors, sensor/event scheduling and traces |
| `projection/` | Stable-ID scene, circuit/logic and material topology projections |
| `examples/` | Reproducible assumed fixtures and their builder |
| `tests/` | Offline contract, physics, compilation, event, projection and CLI tests |

The implementation refines some proposal sketches: behavior-output references are structured objects, instances have no unvalidated free-form configuration, scalar fixtures carry an explicit signal type, and bundles embed fixed-version definitions instead of importing arbitrary paths. There is no general expression evaluator, configuration scripting, or automatic migration from the earlier research DSL.

## Data and identity rules

- A standard component JSON contains its physical/electronic domains. A `component_design` instead exposes category-specific fields and is lowered explicitly; Python modules define authoring types, not dynamically loaded device plug-ins.
- A definition reference includes `id`, positive `revision`, and `content_hash`. Compute it with `element.io.save.content_hash(definition)` after schema validation. The hash covers the expanded/defaulted JSON representation, with sorted object keys and preserved array order. This is an application-specific encoding, not RFC 8785 or a cross-language semantic hash. Python float fields normalize integer inputs during validation; different units are retained in the source representation.
- A bundle pins every definition and the root reference. Nested assemblies expand without ambient directory discovery. Exported ports alias descendant objects. Recursive definitions, conflicting revisions, broken hashes, and missing objects fail compilation.
- References use `{instance_path, collection, object_id}`. Expanded IDs look like `left/servo/joints/axis`; source IDs cannot contain `/`. Ports and connected objects retain these IDs in every view.
- Maps are frozen after validation, and sequences use tuples. Compilation revalidates its input so unchecked Pydantic copy/construct operations cannot bypass external contracts. Do not use unchecked Pydantic construction as an authoring API.
- Project revision bindings are preserved as `input_revisions`. The engine does not enforce user/role permissions or fetch current Context versions. The future server adapter must perform those checks before accepting snapshots or publishing results.
- Parameter bindings are validated against the definition's configurable flag, dimensions and declared range. In this release they are metadata overrides, not an implicit expression language: geometry and behavior parameters must be materialized explicitly in a revised definition before simulation.
- A scenario pins `snapshot_id`; projections reject results from a different snapshot. Result fingerprints also include scenario contents, solver options and random seed. The current models are deterministic and do not generate random noise.

`loads` rejects duplicate JSON keys, non-finite numbers, coercible strings/booleans in numeric fields, extra fields, and unsupported versions. The 16 MiB input bound, 1,000-instance/32-depth expansion limits, 5,000 expanded object limit, collision pair budget, step budget, and trace-cell budget limit common accidental resource explosions. These are not an OS security sandbox; a future host still needs process isolation, cancellation and time/memory limits.

`AssetRef` uses an Artifact ID or a relative library path, plus SHA-256 and media type. The explicit `read_asset` function checks path confinement, resolved symlinks, size and content hash. Artifact IDs must be resolved by the application. No compiler or simulator silently fetches assets or URLs. `save` refuses to overwrite existing files unless explicitly requested; replacement uses a temporary file and atomic rename. Creating a new file uses exclusive creation and is not an application transaction.

## Supported calculations and boundaries

| Area | Implemented | Represented or deferred |
| --- | --- | --- |
| Geometry | Multiple bodies/envelopes, local poses, explicit STL triangle assets and units, visual asset references | No CAD generation or STEP/B-rep |
| Motion | Fixed, revolute, continuous and prismatic tree kinematics; explicit initial conditions and limits | No closed-loop constraint solver, inertia, force or contact dynamics |
| Transmission | Signed rotary ratios and screw lead; follower limits and cycle/driver checks | No gear tooth contact, backlash or elastic belt model |
| Mounts | Typed endpoints, basic kind/thread compatibility; fixed mount compilation or explicit joint binding | Dimension/tolerance fit, friction and contact response are not solved |
| Collision | Sphere/OBB analytic queries; optional FCL triangle BVH with native box/sphere/cylinder/capsule queries and closed-volume containment | Without a mesh, cylinders/capsules still require opt-in outer boxes; convex assets unsupported; no continuous collision proof |
| Electrical | Terminal/network integrity, single ideal power source, voltage rating checks, shared-reference supply gating; `0/1/X/Z`, push-pull and ideal weak pulls/open-drain | No voltage/current network solver, startup/current budget, GPIO mux, I2C addresses, analog ADC, firmware execution or protocol transactions |
| Electronic interfaces | Typed bindings, behavior/supply references and descriptive protocol metadata | Protocol contracts are not executable adapters; unsupported parts are identified in diagnostics |
| Behavior | Constant/pass, NOT/AND/OR, scalar threshold, abstract pulse-to-position, on-delay timer, event state machine | No arbitrary Python, `eval`, general expressions, scripting or dynamic plug-in import |
| Sensing | Typed environment fixtures and committed joint-position samples, independent sample periods and latency | No camera rendering, measurement acquisition, noise or stochastic models |
| Effects | Motion commands; recorded scalar/digital light, sound, heat, display and transport effects | Only motion is physically coupled; other effects do not imply field or flow computation |
| Material | Port/path/connection semantics and topology projection; separately callable mass-conserving inventory primitive | Inventory primitive is not automatically coupled to a path; no CFD, granular dynamics, pressure losses or blockage prediction |
| Design semantics | Functions, principles, realization references and source evidence | No general constraint-expression solver, automatic synthesis or optimization |

Each kinematic root must have an explicit scenario placement. Non-root bodies cannot also receive independent world placements. `anchored=false` records the assumption, but the kinematics mode still retains that root pose; it does not simulate falling or free motion. Missing initial joint positions block simulation. Position drives also require a finite positive speed limit.

Solid, keepout and service envelopes participate in queries; same-body envelope pairs are ignored. Adjacent-body contacts are not silently exempted. Missing solid envelopes and unknown/inner approximations produce coverage diagnostics. Assets are only referenced in projections; the Python package does not render a UI.

Nets must be declared once per terminal after alias resolution. This release deliberately rejects terminals assigned to multiple named nets rather than merging them implicitly. To connect a nested assembly to an outer net, export an otherwise unconnected terminal and declare the complete net at a common assembly scope.

## Behavior and time semantics

All runtime scalar samples use SI values. Source/fixture types can use supported display units, including affine Celsius-to-Kelvin conversion. Direct numeric constant bindings and state-machine numeric outputs are already SI. Angles and lengths remain distinct dimensions.

Fixture names can be instance-scoped, such as `left/enable` and `right/enable`; a local `channel: "enable"` binding uses its full instance path first, then an explicitly provided global `enable` channel. Sensors follow the same rule. This permits independent instances without copying definitions.

The scheduler visits fixed macro boundaries, input events, timer wakeups, sensor sampling times and sensor delivery times. At each boundary:

1. Apply fixture and direct-joint input events.
2. Sample the committed physical state and deliver due observations.
3. Iterate networks and behavior outputs to a bounded fixed point, evaluating state transitions against the same previous state each time.
4. Commit behavior state once, record the boundary, then hold resulting commands while advancing motion to the next boundary.

Macro and sensor sampling intervals must be at least 1 ns. Event-boundary comparisons use a 1 ps tolerance; this engine is not intended for sub-nanosecond circuit timing.

Effects never overwrite joint definitions. Invalid/unknown supply produces unknown output and resets behavior state; absence of a valid motion command holds the numerical position for that interval. This is an explicit ideal-model policy, not a prediction of an unpowered physical actuator.

The timer is an on-delay: continuous valid `1` starts it, a low/unknown input resets it, and its output rises exactly at the scheduled delay. State-machine inputs are event-name changes: a held event token fires once, and repeating the same event requires an intervening different or null token. Ambiguous transitions are rejected. Each state machine exposes one typed `value` output. Unknown combinational cycles remain unknown; nonconvergent evaluation fails the run. Step refinement tests check the supported examples, not general stability of every user model.

## STL import and optional mesh collision

The core primitive path still requires only Pydantic. Install the optional mesh backend in the interpreter used for the engine:

```bash
python -m pip install -r engine/requirements-mesh.txt
python -m engine import-stl path/to/part.stl --unit mm
```

`import-stl` prints `{bundle, scenario, inspection}`. Save the two document values separately, then run `python -m engine simulate bundle.json --scenario scenario.json --asset-root path/to`. The generated asset reference is relative to that explicit root. Imports never recenter, take a convex hull, fill holes, fix winding, or discover arbitrary files. A model authored through Python can instead pass an explicit `asset_resolver(ref) -> bytes` to `simulate` or `cli.dispatch`. Browser uploads use project-owned Artifact IDs.

`triangle_mesh` extends DSL `0.2.0-proposal` with `asset_ref`, required `unit` (`mm`, `cm`, `m`), and `collision_mode` (`surface` by default, or `solid`). No existing primitive fields/defaults change, so the committed example hashes stay valid. The SHA-256 covers original STL bytes; the snapshot also covers declared units and collision mode. Version 0.2.0 of the engine reports these capabilities in result coverage.

- **Surface:** triangle intersections and optional envelope margins. A part entirely inside another surface does not imply collision with that surface.
- **Solid:** additionally detects complete containment. Requires a watertight, consistently wound, positive-volume mesh. These topology checks do not certify freedom from self-intersections, manufacturing defects, or intended material semantics. Use surface mode for open sheets, scanned surfaces, or uncertain topology.
- **Mixed scenes:** when any envelope is a triangle mesh, FCL handles all envelopes, including native boxes, spheres, cylinders and capsules. Surface intersections are followed by point-in-volume checks using one representative per connected mesh component (or the primitive center). Queries use current body and local envelope poses. Same-body pairs are excluded as in the original backend.
- **Limits:** 5 MB and 100,000 triangles per STL; 512 connected components per mesh; 300,000 triangles after instance expansion per simulation. Non-finite/degenerate geometry and coordinates outside ±10 km after scaling are rejected. The web adapter adds aggregate byte and instance limits. ASCII and binary STL are supported; STL has no reliable built-in unit.

We use [Trimesh](https://trimesh.org/install.html) for parsing and topology, [python-fcl](https://github.com/BerkeleyAutomation/python-fcl) for FCL triangle BVHs/native shapes, and Rtree for containment acceleration. FCL provides collision/distance queries without adding a full rigid-body world or changing the existing kinematics scheduler. The dependencies are optional and installed only for this feature; Python-FCL includes native code, so a compatible wheel/toolchain is required.

This integration performs **discrete collision detection**, not bouncing, friction, gravity, or a continuous swept-volume guarantee. Fast motion can pass through between sampled poses. Convex decomposition is not applied: it would change the represented concavities. Closed-volume checks assume a meaningful enclosed volume; neither an overlap nor a lack of overlap certifies a manufactured fit.

## CLI and server integration

```bash
python -m engine schema model_bundle
python -m engine compile engine/examples/actuator.bundle.json
python -m engine scene engine/examples/actuator.bundle.json
python -m engine circuit engine/examples/actuator.bundle.json
python -m engine flow engine/examples/fan.bundle.json
python -m engine request
```

`request` reads exactly one JSON object from standard input and then exits:

```json
{
  "request_id": "caller-request-id",
  "method": "simulate",
  "bundle": {},
  "scenario": {}
}
```

The empty objects above are placeholders for complete validated records. Methods are `validate`, `compile`, `simulate`, `scene`, `circuit`, `flow`, `preview`, and `workspace`. `preview` resolves initial placement and returns all three projections without publishing a simulation result. `workspace` runs the scenario and returns projections plus the simulation result and recorded frames. Standard output contains one JSON result/error object; validation errors omit the submitted values. Exit status is `0` for completed requests and `2` for invalid/failed/unsupported/cancelled requests. Static validation can succeed with unknown/unsupported coverage diagnostics. Simulation emits inline frames; `simulator.recorder.write_ndjson` can serialize frames separately in an explicit host-owned output stream.

The request protocol also accepts `inspect_stl` (`data` as base64, explicit `unit`) and `mesh_bundle` (`meshes` as explicit IDs, shapes and world poses). Model requests may carry an `assets` map from SHA-256 to base64 bytes. Such references must use host-owned Artifact IDs; relative paths are refused in this protocol. `validate`/`compile` verify referenced STL bytes as well as the model contracts.

The Node.js adapter in `apps/server/src/design-engine.ts` passes bounded inline snapshots and verified project assets to a separate Python process, checks Context fingerprints before and after execution, saves immutable run records, and marks changed inputs stale. It never approves stages or replaces the canonical BOM. Credentials and runtime orchestration stay in `apps/server`. The web UI supports STL import, assembly placement, envelope rendering, replay, circuit samples, material topology and diagnostics; see the [adapter contract](../docs/design-engine-integration.md) for execution limits and the remaining integration boundaries.

To regenerate the committed synthetic fixtures after an intentional contract change:

```bash
python -m engine.examples.build_examples
python -B -m unittest discover -s engine/tests -v
```

Repository-wide checks remain `npm run check`, `npm test`, and `npm run build`. Python tests are a separate explicit command; the Node application does not acquire a Python startup dependency.
