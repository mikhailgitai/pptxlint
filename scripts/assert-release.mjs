import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
const channel = process.argv[3] ?? "latest";

assert.ok(
  channel === "latest" || channel === "next",
  "Unknown release channel.",
);
if (channel === "latest") {
  assert.match(
    tag ?? "",
    /^v\d+\.\d+\.\d+$/u,
    "The trusted-publishing workflow accepts stable semver tags only; publish prereleases manually with --tag next.",
  );
} else {
  assert.match(
    tag ?? "",
    /^v\d+\.\d+\.\d+-[0-9A-Za-z][0-9A-Za-z.-]*$/u,
    "The next channel requires a prerelease semver tag.",
  );
}

const root = readJson("package.json");
const cli = readJson("packages/cli/package.json");
const core = readJson("packages/core/package.json");
const version = tag.slice(1);
const schemaBase = `https://unpkg.com/@pptxlint/core@${version}/dist/schemas`;

assert.equal(root.private, true, "The workspace root must remain private.");
assert.equal(root.version, version, "The root version must match the tag.");
assert.equal(cli.version, version, "The CLI version must match the tag.");
assert.equal(core.version, version, "The core version must match the tag.");
assert.equal(cli.private, undefined, "The CLI package must be publishable.");
assert.equal(core.private, undefined, "The core package must be publishable.");
assert.equal(cli.dependencies["@pptxlint/core"], "workspace:*");

for (const manifest of [cli, core]) {
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal("provenance" in manifest.publishConfig, false);
  assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org/");
}

for (const schema of [
  "pptxlint.schema.json",
  "pptxlint-report.schema.json",
  "pptxlint-baseline.schema.json",
]) {
  const document = readJson(`schemas/${schema}`);
  assert.equal(
    document.$id,
    `${schemaBase}/${schema}`,
    `${schema} must use the exact package version as its stable schema ID.`,
  );
}

const baseline = readJson("schemas/pptxlint-baseline.schema.json");
assert.equal(
  baseline.properties.inputs.items.properties.findings.items.properties.ruleId
    .$ref,
  `${schemaBase}/pptxlint.schema.json#/$defs/ruleId`,
  "The baseline schema must reference the config schema from the same exact package version.",
);

const publishWorkflow = readText(".github/workflows/publish.yml");
const actionReferences = [
  ...publishWorkflow.matchAll(/^\s*uses:\s+[^@\s]+@([^\s#]+)/gmu),
].map((match) => match[1]);
assert.ok(
  actionReferences.length > 0,
  "The publish workflow must use actions.",
);
for (const reference of actionReferences) {
  assert.match(
    reference,
    /^[a-f0-9]{40}$/u,
    `Release action reference ${JSON.stringify(reference)} must be a full commit SHA.`,
  );
}

const publishJobStart = publishWorkflow.indexOf("\n  publish:\n");
const registrySmokeJobStart = publishWorkflow.indexOf("\n  registry-smoke:\n");
assert.notEqual(
  publishJobStart,
  -1,
  "The publish workflow must contain a publish job.",
);
assert.ok(
  registrySmokeJobStart > publishJobStart,
  "The publish workflow must contain registry smoke checks after publication.",
);
const publishJob = publishWorkflow.slice(
  publishJobStart,
  registrySmokeJobStart,
);
assert.doesNotMatch(
  publishJob,
  /^\s+registry-url:/mu,
  "The OIDC publish job must not configure setup-node legacy npm authentication.",
);
assert.match(
  publishJob,
  /npm publish "\.\/release\/pptxlint-core-\$\{version\}\.tgz"/u,
  "The OIDC publish job must identify the core tarball with an explicit local path.",
);
assert.match(
  publishJob,
  /npm publish "\.\/release\/pptxlint-\$\{version\}\.tgz"/u,
  "The OIDC publish job must identify the CLI tarball with an explicit local path.",
);

process.stdout.write(`Release invariants passed for ${tag}@${channel}.\n`);

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(resolve(workspaceRoot, relativePath), "utf8");
}
