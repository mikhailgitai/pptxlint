# pptxlint v0.1 specification

## 1. Positioning

> **pptxlint — ESLint for generated PowerPoint.**
>
> Catch broken layout, invalid OOXML, and presentation-policy violations before
> the deck ships.

`pptxlint` checks the final `.pptx` created by a program or AI agent before it is
delivered to a client or published as a CI artifact. It identifies reproducible
structural, geometric, and policy issues; it does not evaluate presentation
content or aesthetics.

The primary user is a developer or team generating PowerPoint files at scale
with `python-pptx`, PptxGenJS, Open XML, Codex, Claude, or an internal
presentation pipeline.

## 2. v0.1 success criterion

```bash
npx pptxlint generated.pptx
# exits 1 and tells me exactly why
```

The tool is useful if it:

- runs locally with one command;
- requires no PowerPoint, LibreOffice, account, or network access;
- identifies the rule, slide, shape, and measurable evidence;
- works reliably in CI;
- allows intentional exceptions;
- supports linting a legacy deck without immediately fixing hundreds of existing
  findings.

## 3. Product principles

### 3.1 Determinism over simulation

The linter analyzes only facts stored in OOXML and unambiguous values derived
from them. It does not claim to know the final PowerPoint layout when that
depends on unavailable font metrics or a specific rendering engine.

### 3.2 Evidence, not vague advice

A finding reports the computed value and the applied threshold:

```text
Stored fontScale results in effective size 8.4pt.
Configured minimum: 12pt.
```

### 3.3 Developer experience is the moat

V0.1 competes through a combination of capabilities rather than rule count:

- local/offline execution;
- predictable configuration;
- stable contracts;
- suppressions;
- baselines;
- SARIF/CI integration;
- fast analysis without opening PowerPoint.

## 4. Scope and non-goals

### Included in v0.1

- one or more local `.pptx` inputs;
- the ten rule IDs in section 7;
- CLI and programmatic `@pptxlint/core`;
- JSON configuration;
- suppressions;
- baseline workflow;
- human-readable, JSON, and SARIF output;
- synthetic fixtures and integration tests.

### Excluded from v0.1

- web UI and REST API;
- cloud upload, accounts, and organization policies;
- repair/auto-fix;
- slide rendering, screenshots, and visual diff;
- AI analysis of content or design;
- health score;
- font substitution;
- attempts to fully reproduce PowerPoint text layout;
- external URL checks;
- `.pptm`, encrypted, and password-protected files;
- npm publication before a separate license and package ownership decision.

## 5. CLI contract

### 5.1 Commands

```bash
pptxlint deck.pptx
pptxlint deck-a.pptx deck-b.pptx
pptxlint deck.pptx --config .pptxlintrc.json
pptxlint deck.pptx --format json
pptxlint deck.pptx --format json --debug
pptxlint deck.pptx --format sarif --output-file pptxlint.sarif
pptxlint legacy-deck.pptx --write-baseline .pptxlint-baseline.json
pptxlint legacy-deck.pptx --baseline .pptxlint-baseline.json
```

V0.1 accepts explicit file paths. Recursive directory scanning and
shell-independent glob expansion may be added later.

### 5.2 Exit codes

| Code | Meaning                                                                                   |
| ---: | ----------------------------------------------------------------------------------------- |
|  `0` | no new unsuppressed findings at or above `failOn`                                         |
|  `1` | at least one new unsuppressed gating finding                                              |
|  `2` | invalid arguments/config, unreadable input, unsupported or non-ZIP file, internal failure |

Malformed XML inside a recognizable OPC/PPTX package is a lint finding, rather
than code 2, when the analyzer can safely produce a partial report.

### 5.3 Default gate

The default `failOn` is `error`. Warnings are printed but do not change the exit
code. CLI `--fail-on warning` or the corresponding config makes warnings gating.

## 6. Finding model

```ts
type Severity = "warning" | "error";

interface FindingLocation {
  part?: string;
  slideNumber?: number;
  slideId?: string;
  shapeIds?: number[];
  shapeNames?: string[];
  paragraphIndex?: number;
  runIndex?: number;
}

interface PptxFinding {
  ruleId: RuleId;
  severity: Severity;
  message: string;
  file: string;
  location: FindingLocation;
  evidence: Record<string, string | number | boolean | string[] | null>;
  fingerprint: string;
}
```

### 6.1 Stable fingerprint

The fingerprint is built from:

- major schema version;
- `ruleId`;
- canonical input key;
- canonical part/slide identity;
- sorted shape IDs;
- the rule's stable semantic discriminator.

Message text, severity, absolute filesystem path, and measured values are
excluded from the fingerprint. Otherwise, changing wording or an overlap
percentage would invalidate the baseline.

V0.1 limitation: a generator that recreates slide/shape IDs on every run may
cause baseline churn. This is explicitly documented; fuzzy matching is outside
the first release.

## 7. Rules v0.1

| Rule ID                            | Default | Purpose                                                               |
| ---------------------------------- | ------: | --------------------------------------------------------------------- |
| `package/broken-relationship`      |   error | an internal non-media relationship targets a missing part             |
| `package/missing-media`            |   error | an image/audio/video relationship targets a missing media part        |
| `package/malformed-xml`            |   error | an XML part is not well-formed XML                                    |
| `layout/outside-slide`             | warning | a local slide shape extends beyond slide bounds past the tolerance    |
| `layout/text-overlap`              | warning | two nonempty text-bearing shapes overlap substantially                |
| `layout/text-occluded`             |     off | a later opaque shape covers text                                      |
| `text/min-font-size`               |   error | stored/resolved effective font size is below policy                   |
| `text/autofit-scale-below-minimum` |   error | stored `fontScale` reduces effective size below policy                |
| `text/autofit-enabled`             | warning | runtime autofit is enabled, but OOXML cannot establish the final size |
| `fonts/allowed`                    |   error | a resolved font is absent from the configured allowlist               |

### 7.1 `package/broken-relationship`

- Only internal targets are checked.
- External targets are indexed but never downloaded or checked for availability.
- Missing media relationships belong to `package/missing-media` and do not
  generate a second finding.
- Evidence: source part, relationship part, rId, relationship type, raw target,
  resolved target.

### 7.2 `package/missing-media`

- Covers known image, audio, and video relationship types.
- Does not attempt to find, download, or generate replacements.
- Evidence also includes media kind and the referencing slide, when identifiable.

### 7.3 `package/malformed-xml`

- The XML inventory is derived from content types and known OOXML part types.
- Each malformed part produces one finding and a cached parse failure.
- DTD and external entities are prohibited.
- Rules with unavailable prerequisites are skipped; the report is marked
  `analysisComplete: false`.

### 7.4 `layout/outside-slide`

- Geometry is computed in EMU, applying nested group transforms and rotation.
- The transformed visible polygon/bounding box is compared with the slide rectangle.
- Evidence: bbox, outside edges, outside area ratio, and tolerance.
- By default, locally authored slide shapes are checked; inherited master/layout
  decorations do not produce v0.1 findings.
- Intentional bleed is handled with a config suppression.

### 7.5 `layout/text-overlap`

- Real-deck calibration downgraded this rule to warning: text-frame geometry
  without a renderer/font metrics is insufficiently precise for a default error.
- Checks pairs of locally authored shapes with nonempty visible text.
- Pairs are canonicalized by shape ID to avoid reporting both A→B and B→A.
- The threshold is intersection area / area of the smaller transformed text box.
- Cells within the same table, and a shape and its own children, are not compared
  as independent text boxes.
- Evidence: both locations, intersection area, and overlap ratio.

### 7.6 `layout/text-occluded`

- Real-deck calibration disabled this rule by default; users may explicitly
  enable it as warning/error for their own controlled corpus.
- Uses slide z-order.
- Findings require a high-confidence opaque occluder: a solid fill with
  sufficient opacity, a JPEG, or an image without alpha. Unknown transparency
  does not establish occlusion.
- Evidence: text shape, foreground shape, occluded ratio, and opacity basis.
- Full pixel-level alpha coverage and renderer-based occlusion are deferred.

### 7.7 `text/min-font-size`

- Effective size is resolved through run/paragraph/list/placeholder inheritance
  within the supported PresentationML style chain.
- Title placeholders and body text use different configured minimums.
- Unresolved sizes are not replaced with invented values.
- Runs under stored `normAutofit@fontScale` that already violate the minimum
  belong to the specialized rule below and are not duplicated.

### 7.8 `text/autofit-scale-below-minimum`

- Applies only when OOXML contains a valid stored `fontScale`.
- `effectivePt = resolvedBasePt × fontScale`.
- Evidence: base size, raw scale, effective size, and configured minimum.
- Does not simulate line breaking or font metrics.

### 7.9 `text/autofit-enabled`

- Applies when runtime autofit is active but no usable persisted scale establishes
  the final size.
- Does not accompany `autofit-scale-below-minimum` for the same shape.
- The message explicitly states that the result depends on installed font metrics
  and the rendering engine.

### 7.10 `fonts/allowed`

- Disabled until the user configures an allowlist.
- Resolves explicit typefaces and theme placeholders through the reachable theme.
- Applies policy separately to Latin, East Asian, and Complex Script slots.
- The `unresolved` option controls unresolved font behavior:
  `ignore | warning | error`.
- Does not inspect fonts installed on the local OS.

## 8. Configuration

`.pptxlintrc.json`:

```json
{
  "$schema": "https://unpkg.com/@pptxlint/core@0.1.2/dist/schemas/pptxlint.schema.json",
  "extends": ["recommended"],
  "failOn": "error",
  "rules": {
    "layout/outside-slide": [
      "warning",
      { "tolerancePt": 2, "minOutsideRatio": 0.05 }
    ],
    "layout/text-overlap": ["warning", { "minOverlapRatio": 0.2 }],
    "layout/text-occluded": "off",
    "text/min-font-size": ["error", { "defaultPt": 12, "titlePt": 20 }],
    "text/autofit-scale-below-minimum": [
      "error",
      { "defaultPt": 12, "titlePt": 20 }
    ],
    "fonts/allowed": [
      "error",
      {
        "families": ["Aptos", "Arial", "Inter"],
        "unresolved": "warning"
      }
    ]
  },
  "ignore": [
    {
      "rule": "layout/text-overlap",
      "slide": 3,
      "shapeIds": [18, 22],
      "reason": "Intentional label overlay"
    }
  ]
}
```

Requirements:

- unknown rule IDs or options produce a config error/code 2;
- supported rule severities are `off`, `warning`, and `error`;
- shape pair IDs are canonicalized regardless of their order in config;
- a suppression requires `rule` and at least one location selector;
- `ignore[].file` is a raw relative logical path and receives the same
  separator-safe canonical encoding as the CLI `inputKey`, including external
  inputs outside the working directory;
- `reason` is recommended and appears in the suppression summary;
- CLI overrides take precedence over config; config takes precedence over preset defaults.

The public schema URL is finalized only before publication; until then, the
schema lives in the workspace and is used by tests/editor fixtures.

## 9. Suppression pipeline

Processing order:

```text
raw findings
  → config severity/options
  → config ignore matching
  → baseline comparison
  → formatter
  → exit policy
```

The report contains counts:

- `new`;
- `existing`;
- `resolved`;
- `suppressed`;
- `analysisComplete`.

Suppressed findings are excluded from the baseline but counted in the suppression
summary. Unused suppressions appear as separate metadata warnings without
introducing a new lint rule ID in v0.1.

## 10. Baseline mode

```bash
pptxlint legacy-deck.pptx --write-baseline .pptxlint-baseline.json
pptxlint legacy-deck.pptx --baseline .pptxlint-baseline.json
```

The baseline contains schema version, tool major version, normalized input key,
and finding fingerprints with minimal location metadata. It contains no file
bytes or slide text.

During linting:

- fingerprint present in the baseline → `existing`;
- fingerprint appearing for the first time → `new`;
- fingerprint present in the baseline but now absent → `resolved`.

Only `new` findings affect exit policy. Existing findings appear in the summary
and are available in JSON. A baseline with an incompatible major/schema version
is rejected with code 2 rather than silently ignored.

## 11. Output formats

### 11.1 Stylish

```text
legacy-deck.pptx

  slide 14 / shapes 18, 22
  warning  layout/text-overlap
  Text boxes overlap by 31% of the smaller box.

  slide 18 / shape 9
  warning  layout/outside-slide
  Shape extends 14pt beyond the right slide edge.

✖ 2 new problems (0 errors, 2 warnings)
  184 existing · 7 resolved · 3 suppressed
```

### 11.2 JSON

JSON uses a versioned schema and contains tool/config versions, input hashes, and
findings grouped by status. Opt-in `--debug` adds aggregate context/rule timings
and peak RSS; unstable performance measurements are omitted from default output.
Absolute local paths are omitted by default; paths relative to the current
working directory are used.

### 11.3 SARIF

- SARIF version 2.1.0.
- Each rule is published in `tool.driver.rules`.
- The `.pptx` is specified as `artifactLocation`.
- Slide/shape details are provided through `logicalLocations`, message, and properties.
- The fingerprint is provided as a partial fingerprint.

Limitation: PPTX is a binary artifact, so standard SARIF cannot provide line-level
annotations or slide images. Visual previews/deep links require a future GitHub
Check/App and rendering service.

## 12. Performance and security

- ZIP entries are indexed once; XML parts are parsed lazily and cached.
- External relationships are never fetched.
- Path traversal, duplicate entry names, DTD/entities, and ZIP bombs are blocked.
- Configurable defaults limit entries, declared/actual uncompressed bytes, XML
  part size, and compression ratio.
- Benchmark fixture: 50 MiB/100 slides. V0.1 records measured time/peak RSS in
  CI/developer documentation without promising identical wall time on every machine.

## 13. Acceptance criteria

- `npx pptxlint generated.pptx` or an equivalent packed CLI command works on a
  clean install and returns code 0/1/2 according to the contract.
- All ten rules have positive, negative, and malformed-prerequisite fixtures.
- Missing media is not duplicated as a broken relationship.
- Autofit rules do not report a computed size without a persisted scale.
- Intentional overlap is suppressed by an exact config suppression.
- Baseline distinguishes new/existing/resolved and fails CI only for new gating
  findings.
- Stylish, JSON, and SARIF outputs pass snapshot/schema tests.
- Findings and fingerprints are deterministic.
- Core/CLI work without PowerPoint, LibreOffice, network, or system-font scanning.
- Tests, lint, typecheck, build, and packed-package smoke pass in CI.

## 14. After v0.1

Priorities are determined by real deck fixtures and usage rather than rule count:

1. GitHub Action/Check with convenient PR summaries;
2. safe `--fix` for strictly provable changes;
3. optional rendering and slide thumbnails;
4. visual baseline/diff;
5. organization policies and hosted history;
6. REST API/web dashboard as part of paid infrastructure.
