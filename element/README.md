# Reusable element library

`element/` owns reusable component descriptions. It has no dependency on `engine`, application Context, Pi, or model providers. `engine/` owns assembly, design records, projections, compilation and simulation.

## Structure

| Package | Responsibility |
| --- | --- |
| `base/` | Strict immutable contracts, identities, units, frames, evidence and signal types |
| `interfaces/` | Local geometry, mounting, motion, terminals, material paths and declarative behavior contracts |
| `categories/` | The existing 14 typed authoring categories, without engine execution methods |
| `schema/library.py` | Versioned definitions, pinned references, capabilities, parameters, catalog entries and search requests |
| `schema/definition.py` | Shared definition identity and descriptive metadata |
| `io/` | Bounded JSON/TOML, asset inspection, deterministic serialization, explicit legacy catalog migration |
| `library/` | Immutable definition files and a rebuildable SQLite index |

The categories are `structure`, `transmission`, `actuator`, `light`, `display`, `sound`, `human_input`, `sensor`, `controller`, `driver`, `power`, `transport`, `energy_storage`, and `circuit_element`. Software/assembly form, origin, role and capability are separate attributes.

## Author and publish

```python
from element.categories import Structure
from element.interfaces.geometry import Box
from element.schema.library import ElementDefinition, ElementQuery
from element.library import ElementLibrary

model = Structure.from_shape(
    id="housing", name="Example housing",
    shape=Box(size_m=(0.1, 0.08, 0.04)),
)
definition = ElementDefinition(
    library_id="personal", element_id=model.id, revision=model.revision,
    name=model.name, category=model.category, origin="template", model=model,
)
library = ElementLibrary("workspace/element-library")
ref = library.publish(definition)
same_definition = library.get(ref)
page = library.search(ElementQuery(categories=("structure",)))
```

All dimensions in this example are synthetic assumptions. The library stores the complete category authoring record in `model`; it does not lower and discard editable fields. Information and non-electrical energy ports are explicit library-level extensions. The outer identity, revision and category must match `model`.

`ElementRef` includes library ID, element ID, revision and SHA-256. Publishing different content under the same identity/revision fails. Existing pinned versions remain readable after withdrawal. A query result is only a candidate, not evidence of compatibility with a project.

Search supports Chinese bigram tokens, normalized names/model aliases, categories, capabilities, protocols, and dimension-checked numeric ranges converted to SI. Missing values do not satisfy numeric conditions. Unverified/assumed numeric descriptions are excluded from numeric filtering unless explicitly enabled. Cursor pagination binds the query and index generation; an index change requires restarting the search.

The source files are authoritative; `index.sqlite3` can be deleted and rebuilt. Catalog updates have their own immutable revisions. Library paths must be explicitly supplied, and all generated data belongs under ignored `workspace/`, not this package. The API does not authorize writes on behalf of a user; an application must authorize its own callers.

## CLI

```bash
python -m element schema element_definition
python -m element validate path/to/element.json
python -m element publish path/to/element.json --root workspace/element-library
python -m element search path/to/query.json --root workspace/element-library
python -m element get path/to/reference.json --root workspace/element-library
python -m element rebuild-index --root workspace/element-library
python -m element seed examples/element --root workspace/element-library
```

`seed` explicitly imports the existing synthetic fixtures as `origin=template` records. Authoring examples live in `examples/element`; engine bundles and generators live in `examples/engine`. `import_catalog_part(part, model)` in `element.io.catalog` imports procurement metadata only with an explicit typed model; it preserves unknown dimensions and does not promote descriptions to measured geometry.

## Engine execution boundary

```python
from engine.adapters.elements import to_bundle, assemble_elements
from engine.compiler.lower import compile_model

ir = compile_model(definition)
bundle = assemble_elements(
    id="pair", name="Two housings",
    elements={"left": definition, "right": definition},
)
```

Engine adapters retain element provenance and namespace library definitions during composition. Import category types directly from `element.categories`. Use `engine.adapters.elements.to_definition()` / `to_bundle()` for execution conversion, `engine.adapters.assembly.assemble_components()` for composition, and `engine.adapters.commands.move_to()` / `set_speed()` for actuator scenario commands. These functions receive the element as an argument; category types do not inherit engine methods. The old engine forwarding modules and compatibility subclasses are removed. Cross-instance nets and mounting connections live in `engine.schema.connections`.

Legacy snapshot hashes retain their original encoding. New element references use the separate `element-v1` domain and Python's deterministic validated JSON encoding; this is not an RFC 8785 claim. See [design records](../engine/design/README.md) for selection and cross-layer use.

Run `python -B -m unittest discover -s element/tests -v` and the existing engine tests after changing these contracts.

## Ownership boundary with engine

An `ElementDefinition` is the authoritative reusable engineering unit. Its category model owns intrinsic geometry, terminals, ratings, mounts, internal motion, material paths, interfaces and behavior. Library-level information and energy ports are part of the same pinned definition. `collections()` exposes these native objects, including transmissions, visual assets, sensors and behavior inputs, without lowering through an execution model.

`engine/design` protocol 2 selects pinned definitions and creates occurrences. It owns placements, initial conditions and connections between units, and resolves local element objects on demand. It must not duplicate intrinsic properties into persisted scheme layers. Changes to geometry, terminal ratings, internal topology or behavior require a revised/derived element definition; scheme placement and connections do not change the element hash. Element contracts have no dependency on engine.

### Single ownership of shared contracts

Terminal properties and electrical validation, material-port properties, and declarative behavior programs are defined once in `element.interfaces`. Scheme views reuse those contracts while binding references in the scheme namespace. Power sources expose their effective electrical terminals in `PowerSource.electrical`, so library occurrences and simulation inputs agree even when wiring is implicit.

Normalized execution containers (`ComponentDefinition`, `PhysicalSpec`, `ElectronicSpec`) belong to `engine.schema.component`. They are compiler inputs rather than an alternate reusable element schema. The old `element.schema.model` import path and identity-only migration wrappers have been removed.

## Common procurement fields and search

All 14 component categories inherit an optional `procurement` record:

```json
{
  "metadata_version": "1",
  "manufacturer": null,
  "model": null,
  "supplier": null,
  "sku": null,
  "purchase_url": null,
  "price": null,
  "currency": "CNY",
  "price_observed_at": null,
  "availability": null,
  "description": "",
  "tags": []
}
```

Purchase URLs must use HTTP(S), prices must be finite and nonnegative, and currency uses three uppercase letters. Null means unknown, never zero/free. No live supplier prices are supplied by the examples. Omitted procurement data preserves existing serialized records and content hashes. Once populated, it participates in the element revision/hash; bump revisions when publishing changed definitions. Time-varying supplier quotations can instead use versioned `CatalogEntry.offers` without changing geometry references.

Library identity is `(library_id, element_id, revision, content_hash)`. JSON definitions are the source of truth; SQLite stores the composite identity, category/status index, normalized search text and token table. Search supports category, capability, protocol, numeric ranges, version policy and cursor pagination. Text uses NFKC/case normalization, Chinese bigrams, and substring matching across ID, name, aliases, category, tags, roles, description, manufacturer, model and SKU. Substring matching scans the filtered candidates; the token table remains available for future large-library optimization. Index rebuilds preserve source definitions and invalidate old cursors explicitly.

```sh
python -m element seed examples/element --root workspace/element-library
python -m element search query.json --root workspace/element-library
python -m element rebuild-index --root workspace/element-library
```

Example `query.json`: `{"text":"servo","categories":["actuator"],"limit":20}`. The standalone engine interface exposes name/text search and category filters, while the CLI retains the richer filters above.
