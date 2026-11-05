# Engine regression fixtures

These synthetic builders and JSON records support compiler, simulation, layout,
legacy-format and CLI regressions. Application code must not load this directory.
The standalone UI uses `examples/project_1` and the configured element pool.

`build_examples.py` regenerates only the three bundle/scenario pairs in `data/`:

```powershell
.\python.cmd -m engine.tests.fixtures.build_examples
```

`build_components.py` and `described_components.py` expose test constructors only;
they do not write to the external element library. `data/gripper.project.json`
remains a v1-format parsing regression, separate from the live project v2 source.
