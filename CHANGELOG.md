# Changelog

All notable changes to pptxlint are documented here.

## 0.1.2 - 2026-09-04

Stable public-beta recovery release:

- publish the verified npm tarballs through trusted publishing using explicit
  local `./release/` paths;
- assert those paths as release invariants so npm cannot reinterpret them as
  GitHub package specifications.

The immutable public `v0.1.1` tag passed every verification gate, but its
publish job failed before contacting npm because the tarball arguments omitted
`./`. No `0.1.1` package was published. Version `0.1.2` supersedes that failed
Git-only release attempt.

## 0.1.1 - 2026-09-04

Public-beta distribution hardening:

- license `pptxlint` and `@pptxlint/core` under Apache-2.0 while keeping the
  workspace root private;
- add complete npm metadata, package READMEs, notices, and published schemas;
- support and test Node.js 22 and 24;
- derive CLI, JSON, and SARIF versions from the package manifest;
- inspect packed manifests and tarball contents, including exact
  `workspace:*` conversion to the matching `@pptxlint/core` version;
- add an English five-minute onboarding path, generator recipes, SARIF CI
  workflow, and reproducible public broken deck;
- add a minimal SHA-pinned, tokenless npm trusted-publishing job with automatic
  provenance and post-publication registry smoke tests;
- ship the reproducible broken deck in the CLI tarball and use exact-version
  unpkg schema URLs that resolve during the prerelease period.

The `0.1.1-beta.0` prerelease was published manually with `--tag next` before
the privacy-safe public repository and npm trusted publishers were configured.
The stable Git tag did not produce npm packages and is superseded by `0.1.2`.

## 0.1.0 - 2026-08-31

Initial local-first CLI release candidate:

- ten deterministic package, layout, text, and font-policy rules;
- JSON config, exact suppressions, and v3 baselines;
- stylish, versioned JSON, and SARIF 2.1.0 output;
- multi-file analysis, output-file safety, and exit codes 0/1/2;
- bounded ZIP extraction, OPC path validation, DTD/entity rejection, and
  no-fetch external relationships;
- opt-in rule timings and peak RSS metadata with `--debug`;
- a generated 50 MiB/100-slide benchmark and packed-package smoke test.
- completed private 30-deck calibration with an anonymous aggregate;
- calibrated `layout/text-overlap` to warning and made
  `layout/text-occluded` opt-in after both missed the default-error precision
  target.

The packages remain private and `UNLICENSED`; no public npm publication is part
of this release candidate.
