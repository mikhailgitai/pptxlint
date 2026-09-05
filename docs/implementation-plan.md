# pptxlint v0.1 implementation plan

A detailed breakdown into mergeable changes is available in the
[Pull Request plan](pull-request-plan.md).

## 1. Delivery strategy

V0.1 is built as a CLI-first vertical slice:

```text
PPTX bytes
  → deterministic findings
  → config/suppressions/baseline
  → stylish/JSON/SARIF
  → exit 0/1/2
```

No web/API/repair/renderer components are created. The primary quality metric is
useful, high-confidence findings with a low false-positive rate.

Approximate estimate: **12–18 engineering days** for one developer, plus time to
collect and manually label a real validation corpus.

## 2. Release slices

| Slice         |    PR | Verifiable outcome                                       |
| ------------- | ----: | -------------------------------------------------------- |
| Foundation    | 01–03 | safe PPTX reading and shared context construction        |
| CLI alpha     |    04 | package rules work through the CLI and exit codes        |
| Rule complete | 05–07 | all ten v0.1 rules implemented                           |
| CI beta       | 08–09 | suppressions, baseline, JSON, and SARIF                  |
| v0.1          |    10 | security/performance/corpus calibration and release docs |

## 3. Stage 1 — workspace and adapter contracts

Corresponds to PR 01–02.

### Deliverables

- pnpm workspace, Node 22, TypeScript strict, Vitest, and CI;
- buildable `@pptxlint/core` and `pptxlint` packages;
- ZIP reader/writer-independent interfaces;
- namespace-aware XML parser adapter;
- duplicate entry and malformed XML contract tests;
- synthetic minimal PPTX builder;
- ADR documenting selected libraries and limitations.

### Exit criteria

- root format/lint/typecheck/test/build pass;
- the packed CLI package installs in a temporary consumer project;
- duplicate ZIP names are not lost through map overwrites;
- DTD/entities are not resolved;
- fixture generation is reproducible.

## 4. Stage 2 — OPC/Presentation context

Corresponds to PR 03.

### Deliverables

- canonical part paths and security limits;
- lazy `ArchiveIndex` and cached `XmlPartStore`;
- content types and relationship graph;
- slide order, slide/layout/master/theme chain;
- shape inventory and z-order;
- partial context with typed diagnostics;
- source SHA-256 and normalized input key.

### Critical tests

- root and part relationship resolution;
- external targets are never fetched;
- nonsequential slide filenames produce correct slide numbers;
- missing/malformed parts do not cause cascading exceptions;
- each entry/XML part is read and parsed at most once.

## 5. Stage 3 — lint engine and CLI alpha

Corresponds to PR 04.

### Deliverables

- versioned finding/report contracts;
- rule registry and prerequisites;
- deterministic fingerprints/sorting;
- JSON config schema and `recommended` preset;
- severity overrides and exit policy;
- package rules:
  - `package/broken-relationship`;
  - `package/missing-media`;
  - `package/malformed-xml`;
- minimal stylish CLI output.

### Exit criteria

```bash
pnpm pptxlint fixtures/generated/missing-media.pptx
# exit 1, exact source/rId/target evidence
```

- Missing media produces one specialized finding.
- Malformed XML inside PPTX returns a finding rather than an internal failure.
- Repeated runs produce identical fingerprints and ordering.
- Codes 0/1/2 follow the specification.

## 6. Stage 4 — geometry rules

Corresponds to PR 05–06.

### 6.1 Geometry engine

- EMU affine transforms;
- nested groups, child coordinate spaces, rotation, and flips;
- transformed polygon/bbox;
- polygon intersection and slide clipping;
- normalized overlap/outside ratios;
- canonical shape-pair identity.

### 6.2 Rules

- `layout/outside-slide`;
- `layout/text-overlap`;
- `layout/text-occluded`.

Occlusion is implemented separately: it requires z-order, fill opacity, and
image alpha evidence. Unknown transparency is not treated as proven occlusion.

### Calibration fixtures

- intentional full-bleed background;
- text boxes with small/large overlaps;
- rotated text boxes;
- nested groups with scaling;
- text under a solid opaque shape;
- text under a transparent shape;
- JPEG and PNG with/without alpha;
- table cells and same-group constructs that cannot be treated as ordinary pairs.

### Exit criteria

- Pair findings are not duplicated in reverse order.
- Evidence contains transformed bounds and ratio.
- Rule messages describe text-frame geometry rather than pixel-perfect glyphs.
- High-confidence negative fixtures produce no findings.

## 7. Stage 5 — text, autofit, and font policy

Corresponds to PR 07.

### Deliverables

- effective run style resolver with provenance;
- paragraph/list/placeholder/layout/master/theme inheritance;
- title/body threshold classification;
- normalized stored autofit scale;
- explicit/theme font resolution for Latin/East Asian/Complex Script;
- rules:
  - `text/min-font-size`;
  - `text/autofit-scale-below-minimum`;
  - `text/autofit-enabled`;
  - `fonts/allowed`.

### Critical tests

- explicit and inherited sizes;
- theme font placeholders;
- mixed scripts;
- persisted scale below/above the minimum;
- runtime autofit without scale;
- unsupported/unresolved style chain;
- no duplicate minimum/autofit findings;
- no dependency on installed system fonts.

### Exit criteria

- The linter never reports a computed effective size without a resolved base size and
  valid persisted scale.
- Unresolved values remain evidence/controlled behavior rather than guessed defaults.
- `fonts/allowed` is disabled without a configured allowlist.

## 8. Stage 6 — suppressions and baseline

Corresponds to PR 08.

### Suppressions

- exact matching by rule + location selectors;
- canonical shape pairs;
- optional reason;
- suppressed count and unused-suppression metadata;
- application before baseline comparison.

### Baseline

- versioned deterministic JSON;
- `--write-baseline`;
- new/existing/resolved classification;
- exit determined only by new gating findings;
- incompatible schema/tool major → code 2;
- no slide text or absolute paths.

### Exit criteria

The complete scenario must work:

```text
184 findings → write baseline
same deck → exit 0, 184 existing
add one overlap → exit 1, 1 new
remove seven old issues → 7 resolved
```

## 9. Stage 7 — CI outputs and package UX

Corresponds to PR 09.

### Deliverables

- final stylish formatter;
- versioned JSON schema;
- SARIF 2.1.0 formatter;
- physical PPTX artifact + logical slide/shape locations;
- partial fingerprints;
- multi-file aggregation;
- `--output-file`;
- clean npm-pack/install/execute smoke;
- README quick start and CI examples.

### Exit criteria

- JSON and SARIF pass schema/snapshot tests.
- Machine output goes only to stdout/output file; diagnostics go to stderr.
- SARIF docs do not promise line-level annotations or slide screenshots.
- The command can run through a locally packed package as
  `npx pptxlint deck.pptx`.

## 10. Stage 8 — hardening and v0.1 release

Corresponds to PR 10.

### Security

- ZIP bomb limits on declared and actual bytes;
- path traversal;
- duplicate entries;
- DTD/entities;
- malformed/truncated archives;
- external relationship no-fetch;
- redaction of slide text/absolute paths from default machine output.

### Performance

- generated 50 MiB/100-slide benchmark;
- time and peak RSS recorded in release evidence;
- rule timings available in JSON debug metadata;
- archive/XML data is not copied separately for each rule.

### Real-deck calibration

Run at least 30 decks before finalizing defaults:

- at least three generators/sources, such as python-pptx, PptxGenJS, and
  PowerPoint-authored/template-based output;
- do not store proprietary decks in the repository;
- manually classify layout/text findings as true/false positives;
- record anonymous aggregate counts and known blind spots;
- downgrade rules with insufficient precision to warning/off or narrow their
  scope rather than compensate with a long README disclaimer.

Default error layout rules target at least 90% precision on the labeled corpus.
This is a product release gate, not a statistical guarantee for every PPTX.

## 11. Fixture matrix

Each rule requires:

- clean negative;
- positive at the threshold boundary and clearly above the threshold;
- malformed prerequisite;
- grouped/rotated variant, where applicable;
- deterministic fingerprint assertion;
- config severity/off override;
- suppression match and non-match;
- baseline new/existing transition.

Large fixtures are generated during test setup. Binary customer files are not
committed.

## 12. CI gates

Target root commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:package
```

Rules are not merged without positive/negative fixtures. Public report/config
schemas are not changed without schema tests and documentation updates.

## 13. Main risks

| Risk                                        | Mitigation                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Intentional overlaps create noise           | v0.1 suppressions, high-confidence defaults, corpus calibration         |
| Baseline churn from regenerated shape IDs   | exact stable fingerprint contract and clearly documented limitation     |
| Group transforms produce incorrect geometry | dedicated matrix test corpus before layout rules                        |
| Autofit creates false precision             | distinguish stored scale from runtime uncertainty                       |
| Font inheritance is incomplete              | provenance/unresolved instead of guessed values                         |
| SARIF cannot show slides inline             | logical locations now; GitHub Check/rendering later                     |
| Competitors have similar rules              | focus on config, baseline, contracts, and local CI developer experience |
| Scope expands again                         | v0.1 non-goals and a separate deferred roadmap                          |

## 14. Definition of Done

V0.1 is ready when:

- all ten rules are implemented and documented;
- the CLI returns stable codes 0/1/2;
- config, suppressions, and baseline work end-to-end;
- stylish/JSON/SARIF outputs are covered by tests;
- the real-deck corpus is calibrated and results documented;
- core/CLI require no Office, LibreOffice, network, or system-font scanning;
- security/performance tests pass;
- packed-package smoke works in a clean consumer project;
- README contains only commands that have actually been executed;
- API/web/repair/rendering are absent from the v0.1 implementation.
