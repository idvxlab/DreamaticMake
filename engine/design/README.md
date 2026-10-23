# Versioned design authoring

This package expresses a scheme as eight typed layers using protocol `2.0.0-draft`. Version 1 records are not accepted by this protocol. Reusable device definitions belong to [`element/`](../../element/README.md). The owning application retains Context authority and approval decisions.

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

## Element ownership and scheme occurrences

```python
from element.library import ElementLibrary
from engine.design import instantiate_element, resolve_design
from engine.design.contracts import ObjectRef
from engine.design.bom import derive_bom

# ref must be a concrete ElementRef obtained by an explicit selection.
definition = ElementLibrary("workspace/element-library").get(ref)
result = instantiate_element(definition, design_id="fan_design")
package = result["package"]
bom_proposal = derive_bom(package)
```

`instantiate_element` writes only a selection record containing a pinned candidate and an occurrence. It embeds the immutable definition once for portability; alternatively a package can omit embedded definitions and resolve through `ElementLibrary`. It never invokes the execution adapter, layout importer, or migration pipeline. Its result contains `package` and `identity_map`; there is no conversion loss report. Without an explicit instance `pose`, placement is unknown.

The selected element owns geometry, terminals and ratings, mounts, internal joints/transmissions, material paths, interfaces, behavior bindings, and library-level information/energy ports. `resolve_design` automatically exposes occurrence objects in the corresponding layers. These effective records are read views, not new authoritative records: persist `resolved.package`, never `resolved.records`.

```python
resolved = resolve_design(package)
instance = ObjectRef(record_id="selection", collection="instances", object_id="instance")
# Obtain addresses for scheme connections without repeating any local attributes.
body = resolved.occurrence_ref(instance, "bodies", "body")
# Example for an element containing terminal "positive":
# terminal = resolved.occurrence_ref(instance, "terminals", "positive")
```

An engineering-layer declaration may consist solely of `source` and `overrides`:

```json
{
  "source": {
    "instance_ref": {"record_id": "selection", "collection": "instances", "object_id": "instance"},
    "local_ref": {"collection": "bodies", "object_id": "body"}
  },
  "overrides": {"pose": {"translation_m": [0.1, 0.0, 0.0]}, "placement": "specified"}
}
```

The declaration names the occurrence at that design address, and internal references follow that address. Selected units cannot define additional intrinsic bodies, geometry, mounts, terminals, ports or internal joints without an element source. Duplicate source declarations, wrong source types, unavailable definitions, and conflicting repeated attributes are errors. Allowed differences are root-body placement and moving-joint initial position. Nested differences merge into the inherited value, then undergo typed validation. Intrinsic changes (shape, pin ratings, behavior, internal topology, etc.) require a derived definition with a new pin in `element/`; scheme-level `parameter_bindings` and copied `occurrence_map` are removed.

`resolved.element_object(binding)` returns the complete native object with references scoped to the binding's instance. `resolved.instance_elements` provides the full selected definition, including category-specific specifications, evidence and firmware. Behavior units use `kind="element"` and retain their source rather than duplicating behavior programs in scheme logic. Their typed input/output ports are available for scheme bindings; their internal execution order remains element-owned. Native object metadata is also available in `project_design(...)["element_occurrences"]`. Narrow layout views are execution projections, never the authoritative element representation.

Multiple occurrences have distinct deterministic addresses and reuse a single pinned definition. BOM aggregation counts selections only and rejects conflicting element sources. All eight manifest layer keys remain present even when the persisted engineering layers are empty.

The former `design_import` / `migrate_layout` path is removed: a layout projection cannot reconstruct authoritative element definitions. Import or define elements first, then select pinned occurrences and author scheme connections.

## Storage and Markdown

`DesignStore(path)` is an optional application-owned SQLite repository, not a second default project database. Its `commit(package, expected_manifest_revision=N)` provides atomic compare-and-swap, immutable record revisions and historical snapshots. No service automatically switches existing Context storage to this repository.

`export_documents(package, destination)` / `import_documents(source)` in `documents.py` support an editable file package. Analysis/function bodies live in `.md` files; metadata does not duplicate their text. Changed imports increment record and manifest revisions. Asset references retain their hashes, and paths are confined to the export root.

## Projection and execution boundaries

`project_design` returns the scene/circuit/flow views, persisted `records`, effective `resolved_records`, a reverse-reference index and omission diagnostics. Every view is bound to the design `snapshot_id`; the older layout fingerprint remains available as `layout_snapshot_id`. Relative body poses compose along the declared hierarchy; unplaced bodies are not silently placed for collision checks.

`check_design` supports reference checks and the existing layout collision, motion and connectivity executors. It records snapshot ID, tool version, options hash and coverage. Other checks return `unsupported`. `compile_design(target="layout")` produces a frozen layout execution input after required reference validation; it is not a compiler from arbitrary Markdown/Python/firmware into a physical simulation. Full legacy simulation still uses `ModelBundle`, `Scenario` and the existing engine compiler, including `compile_model(element_definition)`.

New inline `python -m engine request` methods are:

- `design_validate`, `design_project`: provide `design` as an inline `design_package`.
- `design_check`: also provide `check_kind` and optional `joint_inputs` / verified inline assets.
- `design_compile`: provide `target="layout"`.
- `design_bom`: return a read-only BOM proposal.
- `design_instantiate`: provide `design` as an `element_definition`.

The request envelope remains `{request_id, method, ...}`. The web workbench continues to use its existing layout API; this refactor introduces the Python/JSON scheme protocol and occurrence resolver, not eight new web editors or new authenticated project routes. Code execution stays in the application worker, and approval stays in authenticated application routes.

Run `python -B -m unittest discover -s engine/tests -v` and `python -B -m unittest discover -s element/tests -v`.
