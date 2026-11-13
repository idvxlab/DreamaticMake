# DreamaticMaker v3 architecture

DreamaticMaker uses the task lifecycle from GitHub `design-engine-v2` at `3fc506b` with its existing
full-stage Python contracts. The GitHub branch's native subtask contracts currently cover collision
classification, spatial refinement and joint initialization. The application uses its stage contracts
for the broader product workflow.

## Runtime boundaries

1. The product UI owns projects, user intent, navigation and decisions requested on stage cards.
2. The orchestration package owns the six active roles, stage ownership and project run state.
3. The adapted task runner gates dependencies, pins input context, bounds retries and writes attempt
   receipts. The host stores normalized outputs and their upstream pins with the stage. Historical
   Markdown stays available as context for earlier runs.
4. `CodexServerExecutor` starts the official `codex app-server` over stdio and maps JSON-RPC events into
   product events. It is replaceable through the `AgentExecutor` interface.
5. `process/` supplies schemas and normalizes stage data. `engine/` runs deterministic checks. `element/`
   owns versioned component facts and supplies pinned candidates to hardware selection.
6. Production CAD is routed exclusively to the connected Rhino 8 backend through `packages/cad-runtime`;
   see [cad-toolchain.md](cad-toolchain.md).
   Browser JSCAD is preview-only and cannot satisfy a production CAD request.

## Six roles

| Role | Responsibility |
| --- | --- |
| Project coordinator | requirements, planning, dependencies, risk and user communication |
| Research & analysis | evidence, alternatives, sourcing and assumptions |
| Embedded team | electronics, power, interfaces, wiring and firmware constraints |
| Industrial designer | product language, CMF, ergonomics and appearance assets |
| Mechanical engineer | spatial, enclosure, motion, assembly and manufacturing work |
| Software engineer | controller software architecture, implementation and tests |

Only an actual user decision pauses a stage for input. Structural validation records the contract result.
Engineering checks carry their own execution evidence.

## Codex app-server lifecycle

The adapter uses `initialize`, `initialized`, `thread/start` and `turn/start`, consumes streamed
notifications, and treats only a completed terminal turn as success. Each stage run stores its Codex thread
ID so a later version can resume it. Approval notifications are surfaced to the product UI and are never
answered inside the role prompt.

## Visual direction

The application should inherit DreamaticArt's calm canvas-first composition: warm neutral background,
dark typography, restrained borders, generous whitespace and artifacts as the primary objects. The main
workspace is a three-pane system: project/stage rail, living artifact canvas, and collapsible agent activity.
Engineering state is expressed with text and shape as well as color; terminal-style agent logs must not
become the product's primary interface.
