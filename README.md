# DreamaticMake

A local AI workbench for turning product ideas into hardware plans, enclosure CAD, and Raspberry Pi Pico firmware. Built with React, TypeScript, and the pinned Pi 1.3.0 SDK.

Projects follow eight stages: requirements, intent, hardware, appearance, structure, CAD, firmware, and delivery. Each stage uses independent review and user confirmation.

## Installation

Requirements: **Node.js 22.19+**, **Python 3.11**, and npm. Engineering workers currently require **macOS** for sandboxed execution; Apple Silicon is the verified environment.

From the repository root:

```bash
npm ci --ignore-scripts
npm run setup:cad
npm run build
npm run server
```

`setup:cad` creates `.venv` and installs the locked CAD and PlatformIO dependencies. Ensure `python3` points to Python 3.11 before running it.

Open [http://127.0.0.1:4320](http://127.0.0.1:4320).

For frontend development, use `npm run dev` instead of `npm run server`, then open [http://127.0.0.1:4321](http://127.0.0.1:4321).

## Configuration

Open the top-left menu → **Settings**:

- **Reasoning model:** enter a Chat Completions-compatible API URL, model name, and API key.
- **Image model:** optionally configure a separate image-capable model; empty fields inherit the reasoning configuration.
- **CAD:** verify the Python and PlatformIO paths. Defaults are `.venv/bin/python` and `.venv/bin/pio`.
- **System:** choose English or Chinese, configure trusted HTTPS hardware sources, and select the project workspace.

Settings are saved locally in `.env`. The default hardware source is `https://www.raspberrypi.com/products/`; add other source domains before fetching their pages. Changing the workspace requires a server restart and does not move existing projects.

The first firmware build downloads the PlatformIO toolchain and requires network access. Set the worker timeout to **600 seconds** for initial setup.

## Usage

The hardware tab can search a live local procurement library. Set **Settings → System → Local procurement library directory** to its root (containing `parts_library` and `jd_purchase`). Searches read current SQLite data and extracted parameter evidence without re-exporting; the hardware view refreshes every 30 seconds. Existing project evidence remains versioned. See [local library integration](docs/local-library.md).

Create a project, describe your goals, and answer clarification cards. Review each stage's results before confirming the next stage. The system can revise drafts based on review findings; missing engineering evidence still requires verification. Unverified hardware geometry blocks confirmation.

Current engineering support covers parameterized enclosures and Raspberry Pi Pico firmware. CAD and firmware outputs require actual worker execution; physical printing, assembly, and flashing remain separate steps.

Project files, uploads, agent sessions, toolchains, and generated artifacts live in `workspace/` by default. This directory and `.env` are excluded from Git; back up your workspace separately.

## Product design engine

The lightweight Python library and CLI in [`engine/`](engine/README.md) validate, compile, and simulate product designs and generate scene, circuit, and flow projections. The **CAD workbench** now connects these capabilities to the web application through a bounded Python subprocess. The standalone CLI remains available.

Install the engine dependencies in a virtual environment (independent of the macOS CAD worker):

```bash
python -m venv .venv
# Windows:
.venv/Scripts/python -m pip install "pydantic>=2,<3"
# macOS / Linux:
.venv/bin/python -m pip install "pydantic>=2,<3"
```

In **Settings → CAD**, set **Design engine Python path** to that interpreter. Windows defaults to `.venv/Scripts/python.exe`; macOS/Linux default to `.venv/bin/python`. Python is only started when an engine request runs; the rest of the app can start without it.

Open a project → **CAD workbench**. Load the servo/linkage, fan, or temperature-indicator example, or import a model bundle and scenario JSON. Validate the model, load its initial scene, or run a simulation. The workbench provides envelope geometry with body selection, keepout/service toggles, overlap highlighting, recorded-frame playback, electrical network and signal inspection, material topology, diagnostics, and JSON run export. **Enclosure CAD** retains the existing STL/parametric view and CAD workflow.

For STL import and mesh collision, install the optional stack with `python -m pip install -r engine/requirements-mesh.txt` in the chosen engine environment. A separate `.venv-engine` is also supported: point **Design engine Python path** at its interpreter. Open **Import STL / assemble meshes**, upload ASCII or binary STL, declare mm/cm/m, set placement and surface/solid mode, create the assembly, then run. Original coordinates and concavities are preserved; overlap highlights come from FCL triangle queries, with containment checks for valid closed solids.

Models remain independent immutable snapshots; this integration does not synthesize a model from the BOM or update the authoritative Context. Engine results bind to project inputs and become stale after those inputs change. An initial preview is not a completed simulation, and a completed simulation is not physical validation. Mesh collision is sampled, without contact dynamics or continuous collision guarantees; material flow is topology only. See the [adapter contract](docs/design-engine-integration.md) for limits and endpoints.

With Python 3.11+ and Pydantic 2.x installed, run from the repository root:

```bash
python -m engine validate engine/examples/actuator.bundle.json
python -B -m unittest discover -s engine/tests -v
```

See the [engine documentation](engine/README.md) for setup, API examples, and calculation limits. Local AI collaboration documents in `agent/` are excluded from Git.

## Development checks

```bash
npm run check
npm test
npm run build
```

Optional integration checks:

- `npm run test:engineering` — real CAD generation and Pico compilation.
- `npm run test:pipeline` — eight-stage workflow with local model fixtures and engineering workers.
- `npm run test:ui` / `npm run test:ui:language` — browser regressions; require Chrome at the standard macOS installation path.
- Set `MAKE_ENGINE_TEST_PYTHON` to an installed Python interpreter before `npm test` to include the real engine HTTP tests; otherwise that integration test is explicitly skipped.
- Also set `MAKE_ENGINE_TEST_MESH=1` when that interpreter has `engine/requirements-mesh.txt` installed to include STL HTTP and browser checks. Python mesh tests explicitly skip when the optional stack is absent.
- `npm run test:ui:engine` — real browser + Python engine checks. Set `MAKE_ENGINE_TEST_PYTHON` and `MAKE_TEST_BROWSER` to local Python and Chromium/Edge executable paths first. Screenshots are written to ignored `test-results/`.

See [system design](docs/system-design.md), [implementation status](docs/implementation-status.md), and the [agent protocol](.pi/PROTOCOL.md) for details.
