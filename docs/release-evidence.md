# v0.1 release evidence

## Release status

Version `0.1.0` closed the private release-candidate milestone. Its code,
package, security, performance, and private real-deck calibration gates are
complete. The two layout rules missed the raw 90% precision target and were
downgraded or disabled as required by [calibration.md](calibration.md); neither
remains a below-target default error.

PR 11 prepared `0.1.1-beta.0` for public distribution without changing the
historical `v0.1.0` tag. The CLI and core are Apache-2.0 licensed and were
published to npm on 2026-09-04 from private merge commit `65ec71a`; the root
workspace package remains private. The privacy-safe repository is now public
and both npm trusted publishers are configured. Stable `0.1.1` was attempted
but did not reach npm. Recovery release `0.1.2` requires the corrected tag
workflow and Node.js 22/24 registry smokes.

## Repository privacy migration

The original repository was renamed to the private
`mikhailgitai/pptxlint-private-archive` repository on 2026-09-04. It retains
the complete development history, review records, original beta source commit,
and immutable `v0.1.0` tag. Those Git objects are deliberately not part of the
public repository because their author metadata contains a private email
address.

An initial clean bootstrap was returned to private visibility immediately
after a GitHub-generated squash merge reintroduced account email metadata. It
was renamed to `mikhailgitai/pptxlint-public-bootstrap-private` and none of its
Git objects were reused.

The canonical `mikhailgitai/pptxlint` repository was then recreated again with
`git init` from a tracked-file archive only. Its final privacy-safe root commit
is `0f652b59ed4d1aa7740abf15c2d38d96f2567c40`. No `.git` directory,
historical refs, tags, GitHub pull requests, untracked files, or objects from
the first bootstrap were copied. Public history uses only
`236253073+mikhailgitai@users.noreply.github.com` for author and committer
metadata.

Consequently, registry metadata for the manual beta may identify the private
source commit while the public repository begins at its audited source
snapshot. This is a one-time privacy-preserving bootstrap boundary, not a
claim that the public root commit produced the already-published tarballs.

## Public repository and trusted publishing evidence

Before its final visibility change, the replacement root contained one commit
and no tags. Running `git log --format='%ae%n%ce' --all` returned only
`236253073+mikhailgitai@users.noreply.github.com`; the private email was absent
from tracked files, and private beta commit `65ec71a` was not present as an
object. All four Linux/Windows Node.js 22/24 jobs passed in
[CI run 33918708210](https://github.com/mikhailgitai/pptxlint/actions/runs/33918708210).

npm trusted publishers were then created for both `@pptxlint/core` and
`pptxlint` with these exact claims:

- provider: GitHub Actions;
- repository: `mikhailgitai/pptxlint`;
- workflow filename: `publish.yml`;
- environment: unset;
- allowed operations: direct and staged package publication.

The release workflow grants `id-token: write` only to its minimal publish job,
uses GitHub-hosted runners, and does not provide a long-lived npm token. No
stable package or release tag was created while configuring the trust
relationships; their first successful end-to-end OIDC and
automatic-provenance check will be the reviewed `v0.1.2` recovery release.

## Failed `v0.1.1` stable publication attempt

Public tag `v0.1.1` points immutably to release commit
`6c53b442df2ee34149afeb959f922bb159f9608f`. Every verification and artifact
assembly gate passed in
[workflow run 33920478970](https://github.com/mikhailgitai/pptxlint/actions/runs/33920478970).
The publish job then passed `release/pptxlint-core-0.1.1.tgz` to npm without an
explicit `./` prefix. npm interpreted that argument as a GitHub package spec
and failed with exit code 128 before contacting the registry. The CLI publish
was never attempted, registry smoke was skipped, and neither stable `0.1.1`
package exists in npm.

The tag is not moved or deleted. Recovery version `0.1.2` uses explicit local
tarball paths and adds assertions that prevent this failure mode from
recurring.

## Public-beta distribution evidence

PR 11 adds automated assertions for:

- matching root, CLI, and core versions with a package-derived CLI version;
- Node.js `22.13.0` and `24` CI coverage on Ubuntu and Windows;
- public Apache-2.0 metadata, repository links, package READMEs, licenses, and
  notices;
- direct tarball manifest/file-list inspection and clean-consumer install;
- exact packed CLI dependency conversion from `workspace:*` to the matching
  `@pptxlint/core` version;
- advertised schemas in the core tarball and `.tsbuildinfo`, test, and fixture
  exclusion;
- a byte-reproducible public broken deck and exact stylish/JSON output;
- stable-only OIDC publication through a minimal SHA-pinned job, automatic
  provenance, core-before-CLI ordering, and Node.js 22/24 registry smokes.

The broad TypeScript export surface of `@pptxlint/core` is explicitly beta
until 1.0. Stable beta contracts are rule IDs, schemas, fingerprints, and
documented CLI behavior.

## Manual beta publication evidence

Both packages were published interactively with the 2FA-protected
`mikhailgitai` owner account, `--access public`, and `--tag next`. Core was
published before the CLI. Neither manual publication requested provenance.

| Package                                                                                      | Registry publication (UTC) | Tarball SHA-256                                                    | Registry SHA-1                             |
| -------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| [`@pptxlint/core@0.1.1-beta.0`](https://www.npmjs.com/package/@pptxlint/core/v/0.1.1-beta.0) | 2026-09-04 19:42:00        | `489f9ced38b90a79014a5f38a4897c15a9ba8ee64077ff49dfd36a2b70c9f8f0` | `d419554099876a280637d69868329b7c86d6739c` |
| [`pptxlint@0.1.1-beta.0`](https://www.npmjs.com/package/pptxlint/v/0.1.1-beta.0)             | 2026-09-04 19:50:26        | `baf16f75b839450965a5aa2ec0bac17c5da36b4a695a5879014db9c162462122` | `2e6e559252b9475041c6f85ebec5630575dc7dfc` |

Registry metadata confirms that the packed CLI dependency is exactly
`@pptxlint/core@0.1.1-beta.0`. The published core schema at the immutable unpkg
URL matched the local release artifact with SHA-256
`edeeef32017d036a9281a266ac1d29b75ee250d3f8d8dff199c75770d781fb65`.

A registry-only consumer installed both exact versions into an empty temporary
project, imported the documented core API, ran CLI `--help` and `--version`,
and reproduced the committed broken-deck JSON report using the canonical
`examples/public-broken-deck.pptx` input path. `npm audit signatures` verified
all four packages in that installed dependency tree.

### First-publish `latest` bootstrap exception

npm created both `next` and `latest` for each brand-new package even though the
publish commands explicitly used `--tag next`. An interactive 2FA-authenticated
attempt to remove the core `latest` tag was rejected by the registry with
`E400`; no package or version was unpublished. The owner accepted this measured
bootstrap exception. Until stable `0.1.2` is released, both tags resolve to
`0.1.1-beta.0`, including an unqualified `npm install pptxlint`.

The stable tag workflow must move `latest` to `0.1.2` for both packages while
leaving `next` on `0.1.1-beta.0`. No future prerelease may intentionally move
`latest`.

## Real-deck calibration

The completed private corpus contains 30 decks from four anonymous source
families. One human reviewer labelled 84 findings and Codex visual review
labelled the remaining 304; all 388 decisions were validated for uniqueness
and completeness. The private mapping, source hashes, deck names, extracted
text, and absolute paths are not committed. The anonymous evidence is in
[calibration-aggregate.json](calibration-aggregate.json).

| Rule                   |  TP |  FP | Uncertain | Precision | v0.1 default |
| ---------------------- | --: | --: | --------: | --------: | ------------ |
| `layout/text-overlap`  | 145 | 190 |         0 |     43.3% | warning      |
| `layout/text-occluded` |   0 |  53 |         0 |      0.0% | off          |

The dominant false positives were text-frame intersections whose rendered
glyphs remained separate, plus intentional nested labels, buttons, footers,
and title/subtitle compositions. Area-threshold adjustment alone does not
separate those cases. Pixel-perfect glyph occupancy requires font metrics or a
renderer and remains deferred beyond v0.1.

## Security boundary

Default hard ceilings:

| Limit                             |   Value |
| --------------------------------- | ------: |
| ZIP entries                       |  10,000 |
| One uncompressed part             | 256 MiB |
| One XML part                      |  20 MiB |
| Total declared uncompressed bytes |   1 GiB |
| Compression ratio                 |   200:1 |

Declared metadata is checked before extraction. Actual decompressed bytes are
written through a capped writer, and a forged declared/actual mismatch is
rejected. Regression coverage also includes traversal/canonical conflicts,
duplicate entries, malformed/truncated ZIP, DTD/entities, and external
relationships that remain graph data and are never fetched. Default machine
output uses portable relative identities and never emits extracted slide text.

## Performance benchmark

Run from a clean checkout after installing pinned dependencies:

```bash
pnpm benchmark
```

The command generates a temporary stored ZIP of at least 50 MiB with 100
slides, runs the built CLI in a separate process, prints JSON evidence with
analysis time, peak RSS, and aggregate per-rule timings, then deletes the
fixture. No large binary is committed. Wall time and RSS are evidence for the
recorded machine, not cross-machine promises.

The latest measured output is recorded below after the command is executed for
this release candidate.

```json
{
  "benchmarkVersion": 1,
  "node": "v22.15.1",
  "platform": "darwin-arm64",
  "inputBytes": 52575738,
  "slideCount": 100,
  "analysisMs": 138.924,
  "peakRssBytes": 202440704,
  "ruleTimingsMs": {
    "rule/layout/outside-slide": 0.234,
    "rule/layout/text-overlap": 0.186,
    "rule/package/broken-relationship": 0.13,
    "rule/package/malformed-xml": 0.505,
    "rule/package/missing-media": 0.272,
    "rule/text/autofit-enabled": 0.025,
    "rule/text/autofit-scale-below-minimum": 0.04,
    "rule/text/min-font-size": 0.04
  }
}
```

Measured on 2026-08-31. The fixture was 50.14 MiB; observed peak RSS was
193.06 MiB. The opt-in `layout/text-occluded` rule is absent from default-run
timings after calibration.

## Release workflow evidence

The automated suite covers:

- direct analysis with stylish and JSON output;
- write-baseline, existing/new/resolved classification, and exit gating;
- SARIF schema, physical PPTX artifacts, logical slide/shape locations, and
  partial fingerprints;
- packing both workspace packages, offline installation into a clean temporary
  consumer, `--help`, `--version`, and analysis through the installed binary.

The root quality gate was executed successfully on 2026-08-31:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:package
```

Observed result: formatting, lint, typecheck, integration, build, and packed
package smoke passed; unit tests passed in 16 files with 226 tests.

## Known limitations

- Geometry covers locally-authored slide shapes and text-frame polygons; it is
  not pixel-perfect glyph rendering.
- `layout/text-overlap` is advisory by default, and `layout/text-occluded` is
  opt-in after real-deck calibration showed insufficient precision for a
  blocking default.
- Unknown transparency, unsupported geometry/style inheritance, and theme
  overrides produce conservative no-finding or incomplete-analysis behavior.
- Baselines are exact; regenerated persistent slide/shape IDs can churn.
- SARIF has logical slide/shape locations but no line annotation or preview.
- No repair, rendering, cloud/API/web feature, system-font scan, or network
  access is included in v0.1.
