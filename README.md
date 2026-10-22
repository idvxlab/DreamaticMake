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

See [system design](docs/system-design.md), [implementation status](docs/implementation-status.md), and the [agent protocol](.pi/PROTOCOL.md) for details.
