# pptxlint

`pptxlint` is a deterministic CI gate for generated PowerPoint files. It
checks package integrity, layout, text, and font policy without opening
PowerPoint, then emits stable JSON, baselines, suppressions, or SARIF.

```sh
npx pptxlint@next presentation.pptx
```

Try the fixture included in the package after installing `pptxlint@next`:

```sh
node -e "require('node:fs').copyFileSync(require.resolve('pptxlint/example'), 'public-broken-deck.pptx')"
npx pptxlint public-broken-deck.pptx
```

The public beta supports Node.js 22 and 24. See the
[project README](https://github.com/mikhailgitai/pptxlint#readme) for the
five-minute setup, configuration reference, and GitHub Actions recipe.

The CLI and `@pptxlint/core` are licensed under Apache-2.0. A future rendering-
aware Pro engine, if built, is outside this package and may use a proprietary
license.
