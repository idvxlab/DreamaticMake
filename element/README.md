# Reusable element library

`element/` owns reusable component descriptions. It has no dependency on `engine`, application Context, Pi, or model providers. `engine/` owns assembly, design records, projections, compilation and simulation.

## Structure

| Package | Responsibility |
| --- | --- |
| `base/` | Strict immutable contracts, identities, units, frames, evidence and signal types |
| `interfaces/` | Local geometry, mounting, motion, terminals, material paths and declarative behavior contracts |
| `categories/` | The existing 14 typed authoring categories, without engine execution methods |
| `schema/library.py` | Versioned definitions, pinned references, capabilities, parameters, catalog entries and search requests |
| `schema/model.py` | Legacy per-element model contracts, retained for serialization compatibility |
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
python -m element seed engine/examples/components --root workspace/element-library
```

`seed` explicitly imports the existing synthetic fixtures as `origin=template` records. The legacy files remain in `engine/examples` for compatibility and hash regression testing. `import_catalog_part(part, model)` in `element.io.catalog` imports procurement metadata only with an explicit typed model; it preserves unknown dimensions and does not promote descriptions to measured geometry.

## Engine boundary and compatibility

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
