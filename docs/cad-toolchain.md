# Production CAD toolchain

The mechanical engineer owns CAD decisions. CAD is a scoped tool capability, not an eighth product agent.

## Backend policy

1. **Rhino 8** is the single production CAD backend. The mechanical agent uses the connected Rhino tools for
   NURBS, SubD, solids, Grasshopper graphs, scripted modeling, inspection, 3DM persistence and STEP/STL export.
2. **JSCAD** is preview-only. It may create an early visual mock-up but cannot satisfy a production CAD job,
   emit engineering evidence or unblock review.

The router fails closed when no exact backend satisfies all requested capabilities. It must never silently
replace fillets, constrained sketches, STEP or assembly work with polygonal primitives.

## Required artifacts and evidence

Every production job keeps a 3DM plus its modeling script or Grasshopper definition and emits STEP plus a
display/printing mesh when requested. The Rhino worker reopens or inspects the result and records:

- backend and exact version;
- source and output SHA-256 hashes;
- solid count, B-rep validity, volume and bounding box in millimeters;
- mesh watertightness;
- warnings and unsupported checks.

Passing these checks means the files were generated and geometrically readable. It does not prove strength,
tolerance, printability, regulatory compliance or successful manufacturing.

## Agent modeling loop

1. Read pinned requirements, component STEP files, spatial layout, interfaces and manufacturing limits.
2. Write a parameter table before geometry code; label assumptions separately from sourced dimensions.
3. Build parts around stable local coordinate systems and explicit mounting interfaces.
4. Execute the selected backend; do not claim completion from source text alone.
5. Reopen STEP, mesh the same B-rep, inspect orthographic/isometric renders and run applicable interference checks.
6. Revise until deterministic checks pass, then publish source, STEP, mesh and evidence into the element package.
7. Send the result to the independent reviewer. User approval remains a separate authenticated action.
