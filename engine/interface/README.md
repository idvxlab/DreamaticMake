# Standalone engine interface

The interface owns its renderers, projection types, styles and frontend build configuration. It imports no source from `apps/` or `packages/`, and does not call the application project's API. The application uses small adapters to consume the engine renderers and provide its own translation and authenticated mesh transport.

Start directly from this directory:

```sh
cd engine/interface
npm install
npm run dev
# npm run check
# npm run build
# npm run preview
```

When dependencies are already installed at the repository root, the existing shortcuts also work:

```sh
npm run engine:dev
```

Open http://127.0.0.1:4322. The default design is the two-finger gripper. No application server, application project, API credentials or approval routes are needed. Set `MAKE_ENGINE_PYTHON` if your Python environment is elsewhere; otherwise the launcher tries `.venv-engine` then `python`. Python requires the engine's existing dependencies (including Pydantic).

`npm run build` here (or `npm run engine:build` at the repository root) writes `engine/interface/dist`. `npm run engine:preview` serves that build with the local Python bridge. Opening `index.html` via `file://` is not supported because projections require the local engine.

Views: structure/3D, motion, circuit/energy, material/information, source JSON, and searchable element library. The tree selects entities and bodies, the 3D view supports orbit/zoom/fit/wireframe, and sliders call the real engine's kinematics. Missing geometry is not invented. This is conceptual geometry and kinematics, not manufactured or physically validated output.

Data comes from `examples/element`, `examples/engine` and `examples/project_1`. The default gripper engine example retains the project's finger joints. The raw gripper element contains geometry; its motion constraints are owned by the engine/project design layer.

The Python bridge accepts only enumerated example IDs and read/compute operations. It does not execute the project's Python notebook. The server binds to localhost. Search creates a replaceable SQLite index and immutable definitions under ignored `workspace/element-library`.

Run browser verification with `MAKE_TEST_BROWSER` pointing to a Chromium browser and `npm run test:ui:standalone-engine`.

## Independent distribution layout

Keep these domain modules and example data beside each other; the application folders are unnecessary:

```text
standalone/
  engine/                 # Python engine, including interface/
  element/                # Explicit engine dependency: element contracts/library
  examples/               # Example data for the browser
  workspace/              # Created at runtime; do not distribute runtime contents
```

Install frontend dependencies inside `engine/interface` using its own `package.json`. The Python environment needs Pydantic 2; STL/collision extras are listed in `engine/requirements-mesh.txt`. Set `MAKE_ENGINE_PYTHON` to that Python executable. `element/` and `examples/` remain explicit domain/data dependencies; this interface does not turn the Python engine into a single self-contained folder.

Files owned here:

- `main.tsx`, `style.css`: standalone shell and its styles.
- `components/EngineScene.tsx`: 3D renderer with an optional injected asset loader.
- `components/TopologyGraph.tsx`, `components/TopologyGraph.css`: topology renderer and all its styles.
- `contracts.ts`: engine projection wire types consumed by both the interface and application adapters.
- `package.json`, `tsconfig.json`, `vite.config.ts`: independent frontend package, checks, build and local bridge.

The main application's asset URLs and language settings live only in its adapters. Current standalone examples use analytic geometry; external STL loading requires an explicit asset loader and does not fall back to application APIs.
