# Release runbook

This runbook implements the accepted sequence:

```text
PR 11
  -> manual 0.1.1-beta.0@next
  -> privacy-safe public repository
  -> npm trusted publishing
  -> v0.1.2@latest
  -> registry smoke
```

The historical `v0.1.0` tag is immutable in the private archive and is never
copied or recreated in the public repository. The workspace root is never
published. Publish `@pptxlint/core` before `pptxlint` because the CLI depends
on the exact same version of core after packing.

## 1. Preconditions

- npm organization `pptxlint` exists;
- the publishing account has 2FA enabled;
- organization-level 2FA enforcement is enabled;
- copyright owner is `Mikhail Grankin`;
- PR 11 is merged from a clean, green commit.

## 2. Manual beta on `next`

Run the full gate from the PR 11 merge commit:

```sh
npm install --global pnpm@10.24.0
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:example
pnpm benchmark
pnpm test:package
node scripts/assert-release.mjs v0.1.1-beta.0 next
```

Assemble the exact archives that will be published:

```sh
mkdir -p release
pnpm --filter @pptxlint/core pack --pack-destination release
pnpm --filter pptxlint pack --pack-destination release
```

Authenticate with the 2FA-protected owner account, then publish core first.
The `next` tag is mandatory. Do not pass `--provenance`: the repository is not
public yet, and provenance is deliberately reserved for trusted publishing.

```sh
npm whoami
npm publish ./release/pptxlint-core-0.1.1-beta.0.tgz --access public --tag next
```

After npm prints the successful `+ @pptxlint/core@0.1.1-beta.0` line, a newly
published version can remain temporarily unavailable while npm completes its
publish-time malware scan. Do not retry the immutable publish on an immediate
`npm view` 404. Wait until the exact version resolves from the registry.

The schemas use immutable unpkg URLs containing the exact package version.
After publishing core and before publishing the CLI, confirm that this URL
returns the packaged beta schema:

```text
https://unpkg.com/@pptxlint/core@0.1.1-beta.0/dist/schemas/pptxlint.schema.json
```

Then publish the CLI:

```sh
npm publish ./release/pptxlint-0.1.1-beta.0.tgz --access public --tag next
```

Confirm the registry tags:

```sh
npm view @pptxlint/core dist-tags --json
npm view pptxlint dist-tags --json
```

For the first-ever version of each package, npm created a bootstrap `latest`
tag in addition to the requested `next` tag. The registry rejected an
interactive attempt to remove that `latest` tag with `E400`. This measured
exception is recorded in [release-evidence.md](release-evidence.md): until the
stable release, `next` and `latest` both resolve to `0.1.1-beta.0`. Do not
unpublish or replace the beta. Stable publication must move `latest` to
`0.1.2`, and later prereleases must never move it.

Install both packages into a separate empty directory and run the public
example before continuing. Do not switch the repository to public until the
tarballs and package pages contain no private material.

## 3. Public repository and trusted publishers

After the beta inspection and evidence record:

1. retain the original Git history and `v0.1.0` tag only in the private
   `mikhailgitai/pptxlint-private-archive` repository;
2. create `mikhailgitai/pptxlint` using `git init` from the audited tracked-file
   snapshot, without copying `.git`, refs, tags, or pull-request history;
3. verify a fresh clone with `git log --format='%ae%n%ce' --all` and require
   that every value is the expected GitHub noreply address;
4. switch the new `mikhailgitai/pptxlint` repository to public;
5. configure an npm trusted publisher for both `@pptxlint/core` and `pptxlint`;
6. use GitHub organization/user `mikhailgitai`, repository `pptxlint`, and
   workflow filename `publish.yml` for both package records;
7. do not add a long-lived npm token to GitHub Actions;
8. verify the workflow retains `id-token: write` only on the publish job.
9. until the GitHub account's email-privacy setting is independently verified,
   do not use a GitHub-generated squash merge: land reviewed commits with the
   configured noreply identity and rerun the fresh-clone email audit after
   every public ref change.

Trusted-publisher configuration happens after the beta packages exist. Stable
provenance requires the source repository to be public.

## 4. Prepare stable `0.1.2`

The immutable public `v0.1.1` tag passed verification but did not publish a
package. Its publish commands used `release/*.tgz` without an explicit `./`, so
npm interpreted the argument as a GitHub package spec and failed before
contacting the registry. Both `0.1.1` npm versions remain unused. The corrected
recovery release is `0.1.2`; do not move or recreate `v0.1.1`.

In a small release-only commit:

1. change the root, CLI, and core manifests to `0.1.2`;
2. add the `0.1.2` changelog heading and release date;
3. rebuild and refresh the expected public report because `toolVersion`
   changes;
4. rerun every gate and `node scripts/assert-release.mjs v0.1.2`;
5. use `0.1.2` in all schema IDs, the baseline schema
   reference, and documented `$schema` URLs; the release assertion checks the
   exact immutable unpkg package version.

Refresh the public report with:

```sh
pnpm build
node scripts/verify-public-example.mjs --update
pnpm test:example
```

Create and push the new `v0.1.2` tag only from the reviewed recovery commit. Do
not move `v0.1.1`, or copy, recreate, or move the private archive's `v0.1.0`
tag.

## 5. Automated stable publication

Pushing `v0.1.2` starts `.github/workflows/publish.yml`. The workflow:

- rejects non-stable semver tags and manifest/tag mismatches;
- runs all quality, benchmark, example, and package gates in a job without OIDC
  permission;
- assembles and preserves both tarballs before the OIDC boundary;
- pins every release action to a full commit SHA;
- passes only the verified tarballs to a minimal `id-token: write` job;
- leaves `registry-url` unset in that job so `setup-node@v6` does not create
  legacy npm token authentication; each tarball's `publishConfig.registry`
  selects npmjs;
- publishes core first and CLI second with `latest`; npm trusted publishing
  attaches provenance automatically;
- tolerates an immutable core artifact from a partially completed previous run;
- installs the registry packages on Node.js 22 and 24, compares the public
  report, checks metadata/dist-tags, and audits registry signatures.

If any pre-publication gate fails, fix the release commit and use a new version;
never move a tag that has already produced a public package. npm versions are
immutable.

## 6. Final record

Record the source commit, workflow URL, package URLs, provenance result,
registry-smoke result, and final dist-tags in
[release-evidence.md](release-evidence.md). Stable release is complete only
when `latest` is `0.1.2`, `next` remains the beta, and both Node.js registry
smokes pass.

## 7. Deferred hardening before the next release

These items are non-blocking for `v0.1.2` and remain deliberately deferred
during the assisted-adoption experiment. They are the first engineering tasks
when development resumes and must be completed before creating another release
tag:

1. **Bound registry propagation waits.** Update `registry-smoke.mjs` to retry
   exact-version visibility for both `@pptxlint/core` and `pptxlint` before
   installation. Retry only expected propagation failures such as `E404` and
   `ETARGET`, use fresh registry lookups with bounded backoff, and stop after a
   documented maximum of five minutes with the last error preserved. Other
   registry or authentication failures must fail immediately.
2. **Assert the complete publish command set.** Strengthen
   `assert-release.mjs` to enumerate executable `npm publish` invocations in
   the OIDC job and require exactly two: core first and CLI second, both using
   explicit `./release/*.tgz` local paths, public access, and the `latest`
   dist-tag. An extra command, a missing command, a bare `release/` path, or a
   matching string present only in a comment must fail the assertion.
3. **Disambiguate registry timestamps.** Rename the stable evidence table
   column from `Registry publication (UTC)` to
   `npm registry time metadata (UTC)` and keep the explanation that asynchronous
   package processing can make core visible after the later-submitted CLI. The
   timestamps must not be presented as command execution order.

Completion requires focused regression coverage for the retry terminal cases
and publish-command enumeration, plus format, lint, release assertions, and a
dry-run registry-smoke test. These tasks do not authorize new lint rules, UI,
repair, or rendering work.
