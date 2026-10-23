# Example hierarchy

- `element/`: reusable component authoring records, optional simulation scenarios, and local geometry assets. These cover all 14 element categories.
- `engine/`: assembly bundles, engine scenarios, generators and the gripper mechanism (`gripper.project.json`). Generators use the element contracts and engine APIs without copying engine implementation.
- `project_1/`: the existing mini robot arm and gripper, with `components/`, `design/` layers and `logic/` notebook sources. This is a checked-in example snapshot, separate from ignored runtime `workspace/` and local application `projects/`.

The previous `engine/examples` path has been migrated; tests, application loaders and documentation use the new locations. Generate fixtures from the repository root with `python -m examples.engine.build_examples` and `python -m examples.engine.build_components`.

Browse these designs using `npm run engine:dev`; see [the standalone interface](../engine/interface/README.md).
