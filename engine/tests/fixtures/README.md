# Engine regression fixtures

Synthetic builders and JSON records exercise the active compiler, simulation,
layout, component-authoring and CLI contracts. Application code does not load them.
The workbench defaults to `examples/project_2`; tests no longer depend on the deleted project_1.

`statechart.py` supplies an isolated Sismic model for tool-boundary tests.
`build_examples.py` regenerates the three bundle/scenario pairs in `data/`.
`build_components.py` and `described_components.py` are test-only constructors.
