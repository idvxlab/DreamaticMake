# Design engine web adapter v1

The product design workbench is under the project's CAD tab. `DesignWorkbench` manages input snapshots and recorded results; `EngineScene` renders declared envelopes in meters, with Z up and `[x,y,z,w]` quaternions. The existing `ModelViewer` remains the enclosure CAD view in millimeters. The Python engine is invoked through its existing `request` protocol; no Pi internals are copied and no agent approval tools are introduced.

## Routes

These routes inherit the local application's host/origin checks and require an existing project. The adapter never makes or modifies approval decisions.

| Method | Project-relative route                    | Result                                                               |
| ------ | ----------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/projects/:id/engine`                | Current Context fingerprint, latest saved record, and stale flag     |
| GET    | `/api/projects/:id/engine/examples/:name` | Committed bundle/scenario pair; name is `actuator`, `fan`, or `lamp` |
| POST   | `/api/projects/:id/engine`                | Execute `validate`, `preview`, or `workspace`                        |
| POST   | `/api/projects/:id/engine/cancel`         | Abort that project's active engine process                           |
| GET    | `/api/projects/:id/engine/meshes`         | Project STL asset metadata |
| GET    | `/api/projects/:id/engine/meshes/:assetId` | Verified original STL bytes |
| POST   | `/api/projects/:id/engine/meshes`         | Inspect and save `{name, unit, data}` (base64 STL) |
| POST   | `/api/projects/:id/engine/mesh-model`     | Build pinned bundle/scenario from explicit asset placements |

POST takes `{method, bundle, scenario?, contextKey}`. Fetch `contextKey` from GET first. All inputs are inline records; the client cannot supply commands, filesystem paths, or asset resolver instructions. `preview` and `workspace` require a scenario pinned to the model snapshot. `preview` returns initial placement and projections with `result: null`; `workspace` returns projections and the actual simulation result, including failed/unsupported states and partial frames.

The response is an `EngineState`. Its record contains adapter version 1, request ID, creation time, Context fingerprint, input bundle/scenario, method, and the engine's result/error envelope. HTTP 200 means the request was processed, **not** that validation or simulation succeeded. Always inspect `record.reply.type`, diagnostics, `preview_status`, and `result.status`. Schema errors retain structured locations/messages without echoing submitted values. HTTP 400/409/503 describe adapter-level input, concurrency/staleness, and process failures.

## Freshness and persistence

The Context fingerprint includes the existing workflow input hashes for all stages. Bundle `input_revisions` may bind named project stages to their current revision; unknown or stale bindings are rejected. The bundled `synthetic-fixture: 1` marker is accepted as an explicit fixture marker, not a project revision. Empty bindings denote an independent model snapshot, not an automatically generated project model.

Before execution and again under the project's update queue before publication, the adapter checks the Context fingerprint. Changed inputs cannot publish a current result. Each accepted response is saved once with exclusive creation to `workspace/<project>/jobs/design-engine/<uuid>.json`; a replaced `latest` pointer references the latest record. Earlier records remain immutable. GET compares the saved fingerprint to current inputs; the UI labels stale results. Editing either input document hides previous results until another request completes. Engine records do not populate CAD artifacts, stage approvals, or the canonical BOM.

## Execution limits and dependencies

`MAKE_ENGINE_PYTHON` selects a Python 3.11+ interpreter with Pydantic 2. This is independent of `MAKE_PYTHON` for build123d. One child process handles one request. Its environment is the existing worker allowlist plus UTF-8 output; application provider credentials are not passed. There is no shell evaluation or user-selected command. Execution is limited to one request per project and two globally, at most 120 seconds (or the lower configured worker timeout), the existing 12 MB HTTP body cap and 2 million character worker-output cap. Browser file imports have a 5 MB per-file limit. Explicit cancellation and disconnected response streams abort the child. These controls are not an OS-level memory sandbox.

## View semantics and known boundaries

- Scene geometry comes from declared boxes, spheres, cylinders, capsules and project-owned STL triangle assets. The browser verifies SHA-256 and scales the STL's explicit unit into meters without recentering. External visual/convex assets remain unsupported. Collision queries and coverage remain the engine's responsibility.
- Body transforms, signal samples, effects, and overlap highlights use the same recorded frame. Replay uses recorded timestamps and does not rerun or interpolate physical calculations.
- Frames may be partial on failure. Quality (`valid`, `unknown`, `stale`, `fault`), origin, diagnostics, and coverage remain visible. Unknown samples are never replaced with zero.
- Material paths are topology only. Geometric overlap does not establish physical interference. Engine completion does not certify fabrication, electrical safety, firmware execution, or product acceptance.
- This adapter supports STL assembly creation, model/scenario import and JSON editing. Automatic model synthesis from project BOMs, CAD model generation from engine geometry, and agent-driven model authoring remain separate work.

## STL workflow and collision backend

Install `engine/requirements-mesh.txt` in the configured engine Python environment. In the STL panel, upload one or more files, declare their source units, choose surface or closed-solid collision, set positions in mm and XYZ Euler rotations in degrees, then create the assembly and run. Creating an assembly replaces the editable bundle/scenario; placement edits are applied when that button is pressed. The initial scenario is static (`duration_s: 0`); moving mechanisms can reference these same shapes from existing body/joint definitions in JSON.

The `mesh-model` request is `{contextKey, meshes: [{assetId, unit, collisionMode, position, rotation}]}`. API positions are **meters**, rotations are XYZ Euler degrees, and the host converts them to xyzw quaternions. It accepts 1–32 instances, verifies each asset and checks Context before/after building documents. Asset metadata version 1 records raw-byte SHA-256, declared units, counts, bounds and topology findings. Original bytes live under `workspace/<project>/uploads/engine-meshes/<uuid>.stl`; metadata is published after the bytes. Files are not BOM parts or CAD-stage approval artifacts.

Uploads accept ASCII/binary STL, capped at 5 MB and 100,000 triangles each. Models may inline at most 8 MB of unique assets (32 assets), within the engine's 16 MiB protocol bound; simulation caps expanded triangles at 300,000. Mesh operations share the engine concurrency/cancellation slots and inspection/build subprocesses have a 60-second timeout. Invalid STL produces HTTP 422. Browser asset URLs are confined to the current project; run requests reject filesystem paths, foreign asset IDs, and mismatched hashes.

Trimesh reads topology; FCL uses triangle BVHs and native primitives; Rtree accelerates closed-volume containment. Surface mode tests intersections, while closed-solid mode adds complete-containment checks for watertight, consistently wound, positive-volume meshes. It does not validate all self-intersections or repair the input. The engine preserves concave features and reports the chosen coverage. Detection is sampled and does not implement contact response or continuous collision detection. Primitive-only runs do not need this optional dependency stack.

## Verification

Run `npm run check`, `npm test`, `npm run build`, and `python -B -m unittest discover -s engine/tests -v`. With `MAKE_ENGINE_TEST_PYTHON` configured, `npm test` includes real HTTP → Python → projection tests for all three examples, failed snapshots, and schema diagnostics. Adapter tests additionally cover concurrency, cancellation, immutable records, and Context changes during execution. `npm run test:ui:engine` uses `MAKE_ENGINE_TEST_PYTHON` and `MAKE_TEST_BROWSER` to exercise the browser workflow against real Python results and save screenshots.

Set `MAKE_ENGINE_TEST_MESH=1` alongside the interpreter with optional mesh dependencies to include real STL HTTP and browser regressions. Python mesh tests cover ASCII/binary units, malformed geometry, hashes, surface vs solid containment, concave cavities, rotation, disconnected components, native mixed shapes, margins, same-body exclusion and CLI import.
