# Public beta and design-partner plan

Status: accepted on 2026-08-31.

Execution note, 2026-09-04: the immutable `v0.1.1` tag passed verification but
did not publish to npm because its tarball arguments lacked explicit local
`./` paths. No stable package was created. The corrected `v0.1.2` recovery
release completed OIDC publication, provenance, and Node.js 22/24 registry
smokes; the original sequence below is retained as the accepted plan.

The milestone after the private `v0.1.0` release candidate is **public beta and
the first production users**, not v0.2 feature development. The shortest
validated loop is:

```text
public install -> real generated deck -> repeated CI run
```

The implementation and release sequence is:

```text
PR 11
  -> manual 0.1.1-beta.0@next
  -> privacy-safe public repository
  -> npm trusted publishing (OIDC)
  -> v0.1.1@latest
  -> registry smoke on Node.js 22 and 24
  -> 30 days of assisted adoption
```

## 1. Product boundary

The public free product is the Apache-2.0 licensed `pptxlint` CLI and
`@pptxlint/core`. A future rendering-aware Pro Engine may remain proprietary
and should be kept behind a clear package/repository boundary.

The public positioning is:

> Deterministic CI linting for generated PowerPoint: package integrity, stored
> layout and typography checks, policies, suppressions, baselines, and SARIF.

The public documentation must not imply pixel-perfect rendering, accurate text
reflow, or exact font substitution. `layout/text-overlap` remains advisory and
`layout/text-occluded` remains opt-in after v0.1 calibration.

## 2. PR 11 scope

Proposed title:

```text
chore: prepare pptxlint for public beta distribution
```

PR 11 includes only release hardening and onboarding work:

1. License the CLI and core under Apache-2.0 and add the required copyright and
   notice files after the copyright owner is selected.
2. Keep the root `pptxlint-workspace` package private. Remove `private` only
   from `packages/cli` and `packages/core`.
3. Add publishable package metadata: description, repository with monorepo
   directory, homepage, bugs, keywords, license, engines, and explicit public
   publish configuration where required.
4. Support Node.js `^22.13.0 || ^24.0.0` and test Node.js 22 and 24 explicitly
   in CI on the supported operating systems.
5. Replace duplicated hard-coded CLI versions with one source of truth or a
   release assertion that guarantees the manifests, `--help`, `--version`,
   JSON, and SARIF versions agree.
6. Audit the public `@pptxlint/core` export surface. Stable contracts are rule
   IDs, config/report/baseline schemas, fingerprints, and documented CLI
   behavior. Any broader TypeScript API that is not narrowed before release
   must be labelled beta until 1.0.
7. Publish the config, report, and baseline schemas at stable versioned
   locations and replace `example.invalid` schema IDs.
8. Harden package assembly and extend packed-consumer tests.
9. Replace the mixed-language release-candidate README with an English public
   beta README and package-specific npm READMEs.
10. Add copy-paste recipes for PptxGenJS, `python-pptx`, and GitHub Actions with
    SARIF, plus one public generated broken deck and its deterministic expected
    report.
11. Add a GitHub Actions release workflow for npm trusted publishing and
    automatic provenance, with immutable action pins and a minimal OIDC job
    that does not configure legacy npm token authentication.
12. Update the changelog and release evidence for `v0.1.1` without changing the
    historical `v0.1.0` tag retained in the private archive.

### Explicit non-goals

- new lint rules or threshold tuning unrelated to a release blocker;
- HTML application, dashboard, REST API, GitHub App, or billing;
- repair, safe cleanup, rendering, visual diff, or font-metric work;
- Pro Engine implementation;
- telemetry;
- general presentation delivery preflight.

## 3. Release invariants

The release is not ready unless all of these conditions hold:

1. The historical `v0.1.0` tag remains immutable in the private archive. It is
   not copied, recreated, or repointed in the privacy-safe public repository.
2. The workspace root remains `private: true`.
3. Both public packages use the same release version.
4. The core tarball is published before the CLI tarball.
5. The packed CLI manifest contains a publishable semver dependency on
   `@pptxlint/core`; `workspace:*` must not appear in the tarball.
6. For `0.1.1-beta.0`, that dependency resolves to `0.1.1-beta.0`; for
   `0.1.1`, it resolves to `0.1.1`.
7. `0.1.1-beta.0` is published manually with 2FA and `--tag next`. npm's
   first-version bootstrap also created a non-removable `latest` tag for both
   new packages; this measured exception is accepted only until stable
   `0.1.1`, which must replace it. Later prereleases must not move `latest`.
8. Stable `0.1.1` is published through the configured OIDC workflow and becomes
   `latest` only after all release gates pass.
9. Stable publication runs from a public GitHub repository so npm provenance is
   attached to both packages automatically by trusted publishing. Manual beta
   manifests and commands must not request provenance.
10. Each tarball contains its README, LICENSE, required notices, compiled code,
    declarations, and advertised schemas; the CLI tarball also contains the
    public broken deck. Tarballs exclude `.tsbuildinfo`, tests, private
    fixtures, and repository-only material.
11. Package metadata points to the exact public GitHub repository; each
    monorepo package includes the correct `repository.directory`.
12. A clean registry consumer can install and run both packages on Node.js 22
    and 24.

The packed-package test must inspect the tarball file list and packed manifests,
not only install the archives. It must assert at least:

- package name, version, license, engines, and public metadata;
- README and LICENSE presence;
- `.tsbuildinfo` absence;
- `@pptxlint/core` dependency conversion from `workspace:*` to the exact
  publishable version;
- core import, CLI `--help`, CLI `--version`, and analysis in a clean consumer;
- expected report schema and tool versions.

## 4. External release operations

These operations require the repository/package owner and are deliberately
outside PR 11:

1. Create the npm organization/scope `pptxlint` and confirm ownership.
2. Enable npm account-level 2FA.
3. Select the legal copyright owner for the Apache-2.0 notices.
4. Merge PR 11.
5. Publish both `0.1.1-beta.0` packages manually with 2FA and `--tag next`, core
   first, and record the source commit, hashes, registry results, and any
   first-version dist-tag behavior.
6. Make the GitHub repository public after the license and public documentation
   are present.
7. Configure the same GitHub Actions trusted publisher for `pptxlint` and
   `@pptxlint/core` after the packages exist. npm requires an existing package
   before a trust relationship can be configured.
8. Restrict or revoke bootstrap publishing credentials after OIDC has been
   verified.
9. Create the new `v0.1.1` tag. Do not reuse or rewrite `v0.1.0`.

References:

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [`npm trust` prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)

## 5. Stable publication and registry smoke

The `v0.1.1` workflow must:

1. check out the exact tag;
2. install pinned dependencies;
3. run format, lint, typecheck, unit, integration, build, benchmark, and packed
   package gates;
4. assemble and inspect both tarballs;
5. pass verified tarballs to a minimal GitHub-hosted publish job with
   `id-token: write`, a supported npm CLI, and every action pinned to a full
   commit SHA;
6. publish core first and CLI second;
7. fail without moving `latest` if any pre-publication gate fails.

After publication, run registry—not workspace—smokes on Node.js 22 and 24:

- install `@pptxlint/core@0.1.1` and import its documented public API;
- install `pptxlint@0.1.1` in a clean project;
- run `pptxlint --help` and `pptxlint --version`;
- analyze the public broken deck and compare the deterministic report;
- verify licenses, repository links, dist-tags, and provenance for both
  packages;
- confirm `next` still points to the prerelease and `latest` points to stable
  `0.1.1`.

## 6. Five-minute onboarding contract

The README must take a new user from an empty project to a working local or CI
gate in no more than five minutes. It must include:

- supported Node.js versions and a one-command development dependency install;
- the shortest local invocation;
- PptxGenJS generation followed by linting;
- `python-pptx` generation followed by linting;
- GitHub Actions generation, SARIF upload, artifact fallback, and final job
  gating;
- exit-code semantics and the default error threshold;
- suppressions and baseline links rather than a complete reference inline;
- the public broken deck and expected stylish/JSON result;
- a short, prominent limitations section.

The GitHub Actions recipe must use the current supported
`github/codeql-action/upload-sarif` major. It must preserve the SARIF file when
the linter returns code 1, upload with an unconditional/always step, and then
restore the failing CI result. It must explain that a binary PPTX has no
line-level PR annotation and that private-repository SARIF availability depends
on the repository's GitHub Code Security entitlement. The fallback is an
uploaded SARIF artifact plus the CLI exit gate.

## 7. Thirty-day assisted-adoption experiment

Feature development is frozen for 30 days after stable publication except for
release blockers, correctness/security fixes, documentation, and onboarding
improvements required by an active design partner.

Targets:

| Signal               | 30-day target | Evidence                                                      |
| -------------------- | ------------: | ------------------------------------------------------------- |
| Addressed contacts   |   at least 20 | Personalized contact to an owner of a generated-PPTX pipeline |
| Real installations   |       5 teams | Run on the team's own deck, confirmed by the user             |
| Repeated CI use      |       3 teams | At least two different commit or PR runs                      |
| Problematic fixtures |       2 teams | Sanitized repro with explicit permission to retain/use it     |
| Paid-pilot signal    |        1 team | Named scope, price range, decision owner, and next date       |

npm downloads, GitHub stars, and one-off demo runs do not count as production
validation. Because the product has no telemetry, partner evidence is recorded
manually in a private working log; customer names, decks, and contact details
must not be committed to the public repository.

Operating cadence:

- Week 1: publish, verify onboarding, and contact the first target accounts.
- Week 2: conduct assisted installs and observe the first real runs.
- Week 3: move successful installs into repeat CI and collect minimal fixtures.
- Week 4: review recurring pain, test willingness to pay, and make the v0.2
  decision.

Twenty contacts are a minimum, not a cap. If fewer than two real installations
are confirmed by day 10, expand outreach to at least 40 targeted contacts and
revisit messaging/onboarding before adding product features.

Fixture intake requires sanitization, an explicit retention/use decision, and a
minimal reproduction where possible. Proprietary customer decks are not added
to the repository by default.

## 8. v0.2 decision gate

No v0.2 implementation starts during the experiment. A direction becomes a
candidate only when the same underlying job is requested by at least two
independent teams, or by one team prepared to fund a concrete pilot.

| Observed production demand               | Candidate response                                                  |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Exact overflow or font-substitution risk | Rendering-aware proprietary Pro spike                               |
| Easier PR workflow                       | GitHub Action/App workflow product                                  |
| Brand and template compliance            | Presentation Policy as Code                                         |
| High-volume validation with stronger QA  | Pro/API or self-hosted pilot discovery                              |
| No repeated use                          | Change positioning, onboarding, or target segment; do not add rules |

The first commercial objective is not a dashboard or an arbitrary MRR target.
It is one production team with a problem that is cheaper for the team to solve
by paying for a defined pilot than by building the missing capability itself.
