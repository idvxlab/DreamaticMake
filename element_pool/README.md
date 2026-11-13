# Local element pool

This repository-relative directory is the default element-pool root on the current macOS setup.
Add or import versioned element packages here; each package remains an independent folder with a
`manifest.json` and its declared component or element file.

The repository does not invent hardware records. Until real packages are added, searches correctly return
an empty pool and workflows that require a component must report missing input. Set
`DREAMATIC_ELEMENT_POOL=/absolute/path/to/another/pool` to use a different local library without editing the
checked-in configuration.
