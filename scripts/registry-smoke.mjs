import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2] ?? "";
const consumerDirectory = mkdtempSync(join(tmpdir(), "pptxlint-registry-"));

assert.match(version, /^\d+\.\d+\.\d+$/u, "Expected a stable release version.");

try {
  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "pptxlint-registry-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  run("npm", [
    "install",
    "--save-exact",
    "--no-audit",
    "--no-fund",
    `@pptxlint/core@${version}`,
    `pptxlint@${version}`,
  ]);

  const coreImport = execute(process.execPath, [
    "--input-type=module",
    "--eval",
    "import('@pptxlint/core').then(({ CORE_API_VERSION }) => { if (CORE_API_VERSION !== 1) process.exit(1); })",
  ]);
  assert.equal(coreImport.status, 0, coreImport.stderr);

  const binaryPath = join(consumerDirectory, "node_modules/.bin/pptxlint");
  const help = execute(binaryPath, ["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /ESLint for generated PowerPoint\./u);
  const reportedVersion = execute(binaryPath, ["--version"]);
  assert.equal(reportedVersion.status, 0, reportedVersion.stderr);
  assert.equal(reportedVersion.stdout, `${version}\n`);

  const exampleDirectory = join(consumerDirectory, "examples");
  mkdirSync(exampleDirectory);
  copyFileSync(
    join(
      consumerDirectory,
      "node_modules/pptxlint/dist/examples/public-broken-deck.pptx",
    ),
    join(exampleDirectory, "public-broken-deck.pptx"),
  );
  const report = execute(binaryPath, [
    "examples/public-broken-deck.pptx",
    "--format",
    "json",
  ]);
  assert.equal(report.status, 1, report.stderr || report.stdout);
  assert.equal(report.stderr, "");
  assert.deepEqual(
    JSON.parse(report.stdout),
    readJson(
      resolve(workspaceRoot, "examples/public-broken-deck.expected.json"),
    ),
  );

  for (const packageName of ["pptxlint", "@pptxlint/core"]) {
    const manifest = readJson(
      join(consumerDirectory, "node_modules", packageName, "package.json"),
    );
    assert.equal(manifest.version, version);
    assert.equal(manifest.license, "Apache-2.0");
    assert.equal(
      manifest.repository.url,
      "git+https://github.com/mikhailgitai/pptxlint.git",
    );
    const distTags = JSON.parse(
      execFileSync("npm", ["view", packageName, "dist-tags", "--json"], {
        encoding: "utf8",
      }),
    );
    assert.equal(distTags.latest, version);
    assert.match(distTags.next ?? "", /^\d+\.\d+\.\d+-/u);
  }

  run("npm", ["audit", "signatures"]);
  process.stdout.write(`Registry smoke passed for pptxlint ${version}.\n`);
} finally {
  rmSync(consumerDirectory, { force: true, recursive: true });
}

function run(command, args) {
  execFileSync(command, args, { cwd: consumerDirectory, stdio: "inherit" });
}

function execute(command, args, cwd = consumerDirectory) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
