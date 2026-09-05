# Deferred platform and API concept

> **Status: outside v0.1 scope. Do not implement from this document.**

The first product is the local open-source CLI `pptxlint`. An API and web
dashboard become useful only after rule quality has been validated on real decks
and regular CI usage has emerged.

## Potential paid platform after v0.1

- hosted CI/PR reports;
- organization-wide policies;
- managed baselines and historical regression;
- artifact rendering and slide thumbnails;
- visual diffs;
- GitHub Check/App with deep links;
- retention, audit, and team access controls.

Proposed pipeline:

```text
Codex / Claude / generator
  → generate PPTX
  → pptxlint
  → optional render
  → visual regression
  → CI artifact / PR report
```

No HTTP routes, database schemas, auth flows, or billing contracts are finalized
until usage evidence is available. `@pptxlint/core` remains the single source of
findings for the CLI and any future platform.
