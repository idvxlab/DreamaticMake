# Custom model authoring

The standalone `engine/interface` includes **深化设计 — 定制化模型**. Run `npm run engine:dev` at the repository root. Choose a source design, then open that tab.

This module uses the pinned MIT-licensed `@jscad/modeling@2.13.0` CSG kernel, not the application CAD worker. See the [upstream project](https://github.com/jscad/OpenJSCAD.org) and [boolean operations](https://jscad.app/docs/module-modeling_booleans.html). It creates polygonal solids locally in a cancellable browser worker. It does not provide STEP/B-rep or a CAD feature tree.

The panel lists the selected design's current layout context and imported condition packs. Import one or more `custom_model_conditions/0.1.0-draft` JSON files, or create a condition pack from the context and edit its JSON. All fields, including references, attachment/support requirements, manufacturing and unknowns, remain intact. The context comes from the existing layout projection; it is not a reconstruction of authoritative element definitions. Conditions inform the person entering commands; they are not automatically translated into CAD or checked.

Model commands are line-based, with `#` comments. Dimensions and STL output use millimeters, rotation uses degrees, and all transformations operate about the origin. Primitives are centered at the origin. `extrude` starts at Z=0. Every command names a new object. Re-running rebuilds the whole source. `show` exports separate named parts; without it the last object is shown.

```text
box outer 80 60 30
box inner 76 56 30
move cavity inner 0 0 2
subtract shell outer cavity
show shell
```

Supported commands: `box`, `cylinder`, `sphere`, `move`, `rotate`, `union`, `subtract`, `intersect`, `extrude`, `show`. The interpreter never evaluates JavaScript/Python. Input/operation/output budgets, line diagnostics and the worker timeout protect interactive operation; they are not engineering constraint checks.

Materials (PLA, PETG, ABS, TPU, resin) are authoring selections and preview colors. Switching material does not change geometry, select calibrated tolerances, or prove material performance. There is no collision, fit, strength, assembly or manufacturability validation in this module.

Commands, material and imported conditions are saved in browser local storage per design. Download a model project JSON to transfer the authoring source; download each condition pack separately when needed. Project JSON includes the current context snapshot for inspection. Imported projects must match the selected design and snapshot. Local drafts restored after source changes display a warning and must be rerun; geometry is never restored as current execution evidence. Editing commands or conditions marks the current mesh stale and disables STL export until rerun. A standalone STL carries neither units metadata nor material; the file name/header records the millimeter convention and the project preserves material.

The preview overlays available analytic source envelopes and generated meshes in assembly coordinates. Referenced external meshes are retained in condition data but not loaded by this panel. User-entered geometry is not automatically placed around existing components. No generated parts are automatically published to `element/` or inserted into an authoritative design/BOM. This initial module focuses on command authoring and preview; publication and integration remain future work.

Run `npm run check`, `npm test`, `npm run build`, and `npm run test:ui:standalone-engine`. The custom-model tests execute the real kernel, check boolean volumes and STL readback. The standalone interface declares the same pinned dependency for independent installation.
