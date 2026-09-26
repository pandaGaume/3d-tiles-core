# Contributing

## Development setup

```bash
cd node
npm ci
npm run check
```

## Changes to the wire model

Every model change must identify the corresponding 3D Tiles rule and include fixtures that demonstrate accepted and rejected input when validation behavior changes.

Do not mix renderer-specific values or mutable runtime state into the serializable model.

## Pull requests

- Keep changes scoped to one architectural concern.
- Update tests and documentation with behavior changes.
- Ensure `npm run check` passes from `node/`.

