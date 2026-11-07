# Standalone engine interface

The interface owns its renderers, projection types, styles and frontend build configuration. It consumes the local Python engine and element library through its bounded bridge.

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

Open http://127.0.0.1:4322. The initial example is project_1; use **选择文件夹** or enter a project folder path and **打开项目** to load any project following the v2 folder contract. Successful paths are remembered locally. Set `MAKE_ENGINE_PYTHON` if your Python environment is elsewhere; otherwise the launcher tries `.runtime/python`, `.venv-engine`, then `python`. The Windows repository environment uses `.\npm.cmd run engine:dev`; see [runtime setup](../../RUNTIME.md).

`npm run build` here (or `npm run engine:build` at the repository root) writes `engine/interface/dist`. `npm run engine:preview` serves that build with the local Python bridge. Opening `index.html` via `file://` is not supported because projections require the local engine.

The five views are **结构 / 3D**, **运动视图**, **电路逻辑**, **软件工程**, and **设计源文件**. Structure uses the authored initial configuration and has no pose sliders. Motion has the existing joint controls. Circuit displays actual electrical interfaces and connections. The top-right selector chooses the whole project or any project element key, including local custom parts and pinned library parts. The same views apply at both levels; an element retains its project-defined internal joints, with external assembly nodes hidden.

Software uses each controller's optional `software` link (including project-instance overrides). The left column groups file trees by controller; the right displays read-only UTF-8 source with language and entrypoint. `software` and `software_preview` bridge operations enforce controller scope and project-relative `software/` confinement, excluding links, hidden files and build/dependency folders. A missing declared folder is reported per controller. No source is executed or saved by this view. See [software storage](../project_io.md#软件工程) and [the software workflow](../../process/software_design/README.md).

Circuit ports are drawn on both sides of each component box, including terminals without declared nets. Labels include physical pin numbers when supplied by the element definition. Inputs/power/ground and outputs are grouped visually; bidirectional/passive terminals are balanced between sides. This arrangement is schematic and does not assert physical pin placement. Clicking or keyboard-selecting a port shows its role, pin number and declared project nets/peers. Element scope retains project connection metadata even though the other component boxes are hidden. Nodes grow with the number of ports and support scrolling and dragging.

Source browsing has a folder tree and preview pane. Project scope lists root metadata plus `design/` and `doc/`, excluding `element/`. Element scope reads only the selected element package, resolved from the project or the configured library with its exact pin. JSON, UTF-8 Markdown/text, PDF and common image formats are supported. Markdown is rendered as escaped React text, images are displayed as images, and Python/HTML files are never executed. Text previews are limited to 2 MiB, images/PDF to 8 MiB. The workbench has no standalone library or custom-modeling tab.

Project folders use `project.json`, `element/index.json`, per-element packages, three design JSON layers and `doc/index.json`; see [the project contract](../project_io.md). No test fixture or copied element-property file is used to populate the selector. Folder loading and previews do not modify the project or library.

The local bridge exposes `open_project`, `view`, `files`, `preview` and `mesh`; requests carry an explicit `project_path` and optional element `target`. Preview paths must be in the current scope's allowlist and remain inside its root, including after symlink resolution. Mesh requests additionally identify the owning element and must match a declared STL envelope asset reference. Reads are confined to that element's custom or pinned library package, limited to 5 MB and SHA-256 checked. Hidden files and executable source are excluded. The Windows-only `pick_project` route opens a native folder dialog; other systems can use the path field. The server binds to localhost and rejects mismatched browser origins. It does not execute notebooks or source documents.

Run browser verification with `MAKE_TEST_BROWSER` pointing to a Chromium browser and `npm run test:ui:standalone-engine`.

Deep links accept `?project=<URL-encoded-local-project-path>&view=software`. The explicit project path takes precedence over the remembered folder; unknown view names fall back to structure. The standalone browser regression creates its software fixture in a temporary project and checks code selection and controller scope.

## Independent distribution layout

Keep these domain modules and example data beside each other; the application folders are unnecessary:

```text
standalone/
  engine/                 # Python engine, including interface/
  element/                # Explicit engine dependency: element contracts/library
  examples/project_1/     # Optional initial example; another folder can be selected
  workspace/              # Created at runtime; do not distribute runtime contents
```

Install frontend dependencies inside `engine/interface` using its own `package.json`. The Python environment needs Pydantic 2; STL/collision extras are listed in `engine/requirements-mesh.txt`. Set `MAKE_ENGINE_PYTHON` to that Python executable. `element/` and `examples/` remain explicit domain/data dependencies; this interface does not turn the Python engine into a single self-contained folder.

Files owned here:

- `main.tsx`, `Workbench.tsx`, `api.ts`, `style.css`: workbench shell, project selection and wire types.
- `components/SourceExplorer.tsx`, `project_browser.py`: folder trees, scoped preview and safe file reads.
- `components/EngineScene.tsx`: 3D renderer with an optional injected asset loader.
- `components/TopologyGraph.tsx`, `components/TopologyGraph.css`: topology renderer and all its styles.
- `contracts.ts`: engine projection wire types consumed by the interface.
- `package.json`, `tsconfig.json`, `vite.config.ts`: independent frontend package, checks, build and local bridge.

The workbench injects `meshAssets.ts` into the 3D renderer for both project and element scope. It loads the declared STL, checks its hash again in the browser, and respects the envelope's length unit and body pose. Repeated instances share cached bytes; different meshes with the same relative filename are distinguished by hash. STEP remains the editable CAD exchange deliverable; the browser displays its authored STL counterpart rather than parsing STEP. The reusable custom-model components remain separate from the workbench tabs.
