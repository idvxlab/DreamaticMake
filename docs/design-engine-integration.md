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

POST takes `{method, bundle, scenario?, contextKey}`. Fetch `contextKey` from GET first. All inputs are inline records; the client cannot supply commands, filesystem paths, or asset resolver instructions. `preview` and `workspace` require a scenario pinned to the model snapshot. `preview` returns initial placement and projections with `result: null`; `workspace` returns projections and the actual simulation result, including failed/unsupported states and partial frames.

The response is an `EngineState`. Its record contains adapter version 1, request ID, creation time, Context fingerprint, input bundle/scenario, method, and the engine's result/error envelope. HTTP 200 means the request was processed, **not** that validation or simulation succeeded. Always inspect `record.reply.type`, diagnostics, `preview_status`, and `result.status`. Schema errors retain structured locations/messages without echoing submitted values. HTTP 400/409/503 describe adapter-level input, concurrency/staleness, and process failures.

## Freshness and persistence

The Context fingerprint includes the existing workflow input hashes for all stages. Bundle `input_revisions` may bind named project stages to their current revision; unknown or stale bindings are rejected. The bundled `synthetic-fixture: 1` marker is accepted as an explicit fixture marker, not a project revision. Empty bindings denote an independent model snapshot, not an automatically generated project model.

Before execution and again under the project's update queue before publication, the adapter checks the Context fingerprint. Changed inputs cannot publish a current result. Each accepted response is saved once with exclusive creation to `workspace/<project>/jobs/design-engine/<uuid>.json`; a replaced `latest` pointer references the latest record. Earlier records remain immutable. GET compares the saved fingerprint to current inputs; the UI labels stale results. Editing either input document hides previous results until another request completes. Engine records do not populate CAD artifacts, stage approvals, or the canonical BOM.

## Execution limits and dependencies

`MAKE_ENGINE_PYTHON` selects a Python 3.11+ interpreter with Pydantic 2. This is independent of `MAKE_PYTHON` for build123d. One child process handles one request. Its environment is the existing worker allowlist plus UTF-8 output; application provider credentials are not passed. There is no shell evaluation or user-selected command. Execution is limited to one request per project and two globally, at most 120 seconds (or the lower configured worker timeout), the existing 12 MB HTTP body cap and 2 million character worker-output cap. Browser file imports have a 5 MB per-file limit. Explicit cancellation and disconnected response streams abort the child. These controls are not an OS-level memory sandbox.

## View semantics and known boundaries

- Scene geometry comes from declared boxes, spheres, cylinders, and capsules. External visual/convex assets are reported as not loaded, rather than fetched or silently approximated. Collision queries and coverage remain the engine's responsibility.
- Body transforms, signal samples, effects, and overlap highlights use the same recorded frame. Replay uses recorded timestamps and does not rerun or interpolate physical calculations.
- Frames may be partial on failure. Quality (`valid`, `unknown`, `stale`, `fault`), origin, diagnostics, and coverage remain visible. Unknown samples are never replaced with zero.
- Material paths are topology only. Geometric overlap does not establish physical interference. Engine completion does not certify fabrication, electrical safety, firmware execution, or product acceptance.
- This adapter supports model/scenario import and JSON editing. Automatic model synthesis from project BOMs, mesh loading, CAD model generation from engine geometry, and agent-driven model authoring remain separate work.

## Verification

Run `npm run check`, `npm test`, `npm run build`, and `python -B -m unittest discover -s engine/tests -v`. With `MAKE_ENGINE_TEST_PYTHON` configured, `npm test` includes real HTTP → Python → projection tests for all three examples, failed snapshots, and schema diagnostics. Adapter tests additionally cover concurrency, cancellation, immutable records, and Context changes during execution. `npm run test:ui:engine` uses `MAKE_ENGINE_TEST_PYTHON` and `MAKE_TEST_BROWSER` to exercise the browser workflow against real Python results and save screenshots.
