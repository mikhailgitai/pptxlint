# @pptxlint/core

`@pptxlint/core` contains the deterministic PowerPoint analysis pipeline used
by the `pptxlint` CLI.

```sh
npm install @pptxlint/core@next
```

The stable public contracts in the beta are rule IDs, configuration schema,
report schema, baseline schema, finding fingerprints, and CLI behavior. The
broad TypeScript export surface remains a beta API until 1.0 and can change in
minor releases.

Published JSON Schemas are exported as:

- `@pptxlint/core/schemas/config`
- `@pptxlint/core/schemas/report`
- `@pptxlint/core/schemas/baseline`

See the [project README](https://github.com/mikhailgitai/pptxlint#readme) for
usage and compatibility details.
