# Bootstrap packages

This directory contains immutable npm archives needed to build the workspace before their public registry release exists.

`@spacexr/3d-tiles-runtime` declares a normal semantic-version dependency on `@spacexr/geodesy`. The workspace root installs the matching archive from this directory only as a development bootstrap. Published runtime manifests therefore never contain a machine-local path.

Regenerate the archive from the adjacent `geodesy_ts` repository:

```powershell
cd ..\..\geodesy_ts
npm run check
npm pack --pack-destination ..\3d-tiles-core\node\vendor
```

Replace the archive and update the workspace development dependency whenever the geodesy version changes. The archive can be removed after that exact version is available from the configured npm registry, provided CI installs it from the registry.
