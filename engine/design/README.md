# Versioned design authoring

This package expresses a design as eight typed layers. Reusable device definitions belong to [`element/`](../../element/README.md). The owning application retains Context authority and approval decisions.

| `kind` | Editable source |
| --- | --- |
| `analysis` | Markdown documents, subjects and evidence-backed/assumed conclusions |
| `function` | Markdown function cards, hierarchy, typed ports, criteria and realization references |
| `selection` | Requirements, pinned candidates, decisions, discrete occurrences or bulk quantities |
| `structure` | Bodies, local/world placement, geometry, mounts and connections |
| `motion` | Joints, transmissions, drives and initial conditions |
| `circuit_energy` | Terminals, nets and explicit energy transfers |
| `flow` | Material and information ports, directed edges and required paths |
| `logic` | Declarative behaviors, inert Python/Markdown cells, firmware references and bindings |

`contracts.py` is the strict Pydantic source of truth. `python -m engine schema design_record`, `design_manifest`, and `design_package` export JSON Schema, including the discriminated union. Each layer may contain multiple records; every manifest has all eight keys, including empty layers.

## Create and resolve

```python
from engine.design import make_package, resolve_design, project_design, check_design

package = make_package(
    design_id="fan_design", title="Fan design",
    records=[{
        "record_kind": "design_record", "design_id": "fan_design",
        "record_id": "cooling_goal", "kind": "function", "title": "Cooling",
        "data": {"body": {"text": "# Cooling\nDefine the operating target here."}},
    }],
)
resolved = resolve_design(package)
views = project_design(package)
report = check_design(package, "references")
```

Records and manifests are immutable revisions. References use `{record_id, collection, object_id}` and resolve only within the pinned manifest. Internal IDs are stable, independent of display names and array order. `unit_inputs` / `unit_outputs` use `unit_id:port_id` as their object IDs; bulk usage exposes its optional occurrence as `instances/bulk`.

Malformed records, mismatched pins and duplicate identities are rejected. Incomplete selection, missing references, conflicting nets and unsupported mechanisms remain editable and receive diagnostics. Projection does not execute Python or require a successful simulation. A layout omission, unsupported check or incomplete evidence never certifies a physical pass.

## Selection, library integration and migration

```python
from element.library import ElementLibrary
from engine.design.migrate import instantiate_element, migrate_layout
from engine.design.bom import derive_bom

# ref must be a concrete ElementRef obtained by an explicit selection.
definition = ElementLibrary("workspace/element-library").get(ref)
result = instantiate_element(definition, design_id="fan_design")
package = result["package"]
bom_proposal = derive_bom(package)
```

`instantiate_element` explicitly materializes the chosen definition into editable layers and embeds the pinned source. Its loss report identifies descriptions that remain in the source rather than pretending a layout is a complete execution model. Multiple instances reuse one definition. A BOM proposal aggregates only chosen instances/bulk use, preserves the design snapshot, and never writes the application's canonical BOM. Parameter changes that affect geometry or behavior require a pinned derived definition before BOM publication.

`migrate_layout(legacy_draft, design_id=..., title=...)` returns `package`, `identity_map`, `losses` and `original_layout`. Legacy `part_id` values do not become exact library references automatically. Missing ratings/pin numbers and undirected flow are explicitly reported; flow directions are never guessed. The original layout remains in the migration report for manual completion. This is not a promise of lossless conversion back to the old format.

## Storage and Markdown

`DesignStore(path)` is an optional application-owned SQLite repository, not a second default project database. Its `commit(package, expected_manifest_revision=N)` provides atomic compare-and-swap, immutable record revisions and historical snapshots. No service automatically switches existing Context storage to this repository.

`export_documents(package, destination)` / `import_documents(source)` in `documents.py` support an editable file package. Analysis/function bodies live in `.md` files; metadata does not duplicate their text. Changed imports increment record and manifest revisions. Asset references retain their hashes, and paths are confined to the export root.

## Projection and execution boundaries

`project_design` returns the existing scene/circuit/flow views plus all typed records, a reverse-reference index and omission diagnostics. Every view is bound to the design `snapshot_id`; the older layout fingerprint remains available as `layout_snapshot_id`. Relative body poses compose along the declared hierarchy; unplaced bodies are not silently placed for collision checks.

`check_design` supports reference checks and the existing layout collision, motion and connectivity executors. It records snapshot ID, tool version, options hash and coverage. Other checks return `unsupported`. `compile_design(target="layout")` produces a frozen layout execution input after required reference validation; it is not a compiler from arbitrary Markdown/Python/firmware into a physical simulation. Full legacy simulation still uses `ModelBundle`, `Scenario` and the existing engine compiler, including `compile_model(element_definition)`.

New inline `python -m engine request` methods are:

- `design_validate`, `design_project`: provide `design` as an inline `design_package`.
- `design_check`: also provide `check_kind` and optional `joint_inputs` / verified inline assets.
- `design_compile`: provide `target="layout"`.
- `design_bom`: return a read-only BOM proposal.
- `design_import`: provide `draft` as a legacy `layout_draft`.
- `design_instantiate`: provide `design` as an `element_definition`.

The request envelope remains `{request_id, method, ...}`. The web workbench continues to use its existing layout API; this refactor introduces the Python/JSON data layer and compatibility bridge, not eight new web editors or new authenticated project routes. Code execution stays in the application worker, and approval stays in authenticated application routes.

Run `python -B -m unittest discover -s engine/tests -v` and `python -B -m unittest discover -s element/tests -v`.
