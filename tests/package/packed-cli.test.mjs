import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const workspaceRoot = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), "pptxlint-package-"));
const packsDirectory = join(temporaryRoot, "packs");
const consumerDirectory = join(temporaryRoot, "consumer");
const fixtureBuildersDirectory = join(temporaryRoot, "fixture-builders");
const sourceCliManifest = readJson(
  resolve(workspaceRoot, "packages/cli/package.json"),
);
const sourceCoreManifest = readJson(
  resolve(workspaceRoot, "packages/core/package.json"),
);
const releaseVersion = sourceCliManifest.version;

assert.equal(sourceCoreManifest.version, releaseVersion);
assert.equal(sourceCliManifest.dependencies["@pptxlint/core"], "workspace:*");

try {
  mkdirSync(packsDirectory, { recursive: true });
  mkdirSync(consumerDirectory, { recursive: true });

  const coreArchive = packPackage(
    "pnpm",
    [
      "--filter",
      "@pptxlint/core",
      "pack",
      "--pack-destination",
      packsDirectory,
    ],
    resolve(workspaceRoot, "packages/core"),
    { cwd: workspaceRoot },
  );
  const cliArchive = packPackage(
    "pnpm",
    ["--filter", "pptxlint", "pack", "--pack-destination", packsDirectory],
    resolve(workspaceRoot, "packages/cli"),
    { cwd: workspaceRoot },
  );
  const parseXmlArchive = packPackage(
    "pnpm",
    ["pack", "--pack-destination", packsDirectory],
    resolve(workspaceRoot, "packages/core/node_modules/@rgrove/parse-xml"),
  );
  const zipArchive = packPackage(
    "pnpm",
    ["pack", "--pack-destination", packsDirectory],
    resolve(workspaceRoot, "packages/core/node_modules/@zip.js/zip.js"),
  );

  const packedCli = inspectArchive(cliArchive);
  const packedCore = inspectArchive(coreArchive);
  assertPackedManifest(packedCli.manifest, "pptxlint", releaseVersion);
  assertPackedManifest(packedCore.manifest, "@pptxlint/core", releaseVersion);
  assert.equal(
    packedCli.manifest.dependencies["@pptxlint/core"],
    releaseVersion,
    "pnpm pack must rewrite workspace:* in the packed manifest",
  );
  assertArchiveContents(packedCli.entries, { example: true, schemas: false });
  assertArchiveContents(packedCore.entries, { example: false, schemas: true });

  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "pptxlint-smoke", private: true }, null, 2)}\n`,
  );
  runCommand(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--package-lock=false",
      parseXmlArchive,
      zipArchive,
      coreArchive,
      cliArchive,
    ],
    {
      cwd: consumerDirectory,
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, "npm-cache"),
      },
      stdio: "pipe",
    },
  );

  const binaryPath = join(
    consumerDirectory,
    "node_modules/.bin",
    process.platform === "win32" ? "pptxlint.cmd" : "pptxlint",
  );
  const coreImport = executeCommand(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import('@pptxlint/core').then(({ CORE_API_VERSION }) => { if (CORE_API_VERSION !== 1) process.exit(1); })",
    ],
    { cwd: consumerDirectory },
  );
  assert.equal(coreImport.status, 0, coreImport.stderr);

  const helpResult = executeCommand(binaryPath, ["--help"], {
    cwd: consumerDirectory,
  });
  assert.equal(helpResult.status, 0);
  assert.equal(helpResult.stderr, "");
  assert.match(helpResult.stdout, /ESLint for generated PowerPoint\./u);
  assert.match(
    helpResult.stdout,
    new RegExp(`^pptxlint ${escapeRegExp(releaseVersion)}$`, "mu"),
  );

  const versionResult = executeCommand(binaryPath, ["--version"], {
    cwd: consumerDirectory,
  });
  assert.equal(versionResult.status, 0);
  assert.equal(versionResult.stderr, "");
  assert.equal(versionResult.stdout, `${releaseVersion}\n`);

  const fixtureDirectory = join(consumerDirectory, "fixtures");
  mkdirSync(fixtureDirectory, { recursive: true });
  const fixturePath = join(fixtureDirectory, "deck.pptx");
  writeFileSync(fixturePath, await buildMinimalPptx());

  const inputPath = join("fixtures", "deck.pptx");
  const analysis = executeCommand(binaryPath, [inputPath, "--format", "json"], {
    cwd: consumerDirectory,
  });
  assert.equal(analysis.status, 0);
  assert.equal(analysis.stderr, "");
  const report = JSON.parse(analysis.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.toolVersion, releaseVersion);
  assert.equal(report.analysisComplete, true);
  assert.equal(report.inputs.length, 1);
  assert.equal(report.inputs[0].input.file, "fixtures/deck.pptx");
  assert.equal(report.inputs[0].input.inputKey, "fixtures/deck.pptx");
  assert.equal(report.summary.total, 0);

  const installedCliDirectory = join(
    consumerDirectory,
    "node_modules/pptxlint",
  );
  const installedCli = readJson(join(installedCliDirectory, "package.json"));
  assert.equal(installedCli.private, undefined);
  assert.equal(installedCli.version, releaseVersion);
  assert.equal(installedCli.license, "Apache-2.0");
  assert.equal(installedCli.author, "Mikhail Grankin");
  assert.equal(
    installedCli.dependencies["@pptxlint/core"],
    releaseVersion,
    "pnpm pack must rewrite workspace:* to the exact publishable core version",
  );
  assertPackageDocuments(installedCliDirectory);
  assertNoBuildMetadata(installedCliDirectory);
  const exampleResolution = executeCommand(
    process.execPath,
    ["--print", "require.resolve('pptxlint/example')"],
    { cwd: consumerDirectory },
  );
  assert.equal(exampleResolution.status, 0, exampleResolution.stderr);
  const packagedExamplePath = exampleResolution.stdout.trim();
  assert.equal(existsSync(packagedExamplePath), true);
  const packagedExample = executeCommand(
    binaryPath,
    [packagedExamplePath, "--format", "json"],
    { cwd: consumerDirectory },
  );
  assert.equal(packagedExample.status, 1);
  assert.equal(packagedExample.stderr, "");
  const packagedExampleReport = JSON.parse(packagedExample.stdout);
  assert.equal(packagedExampleReport.toolVersion, releaseVersion);
  assert.deepEqual(packagedExampleReport.summary.new, {
    errors: 2,
    warnings: 1,
    total: 3,
  });

  const installedCoreDirectory = join(
    consumerDirectory,
    "node_modules/@pptxlint/core",
  );
  const installedCore = readJson(join(installedCoreDirectory, "package.json"));
  assert.equal(installedCore.private, undefined);
  assert.equal(installedCore.version, releaseVersion);
  assert.equal(installedCore.license, "Apache-2.0");
  assert.equal(installedCore.author, "Mikhail Grankin");
  assertPackageDocuments(installedCoreDirectory);
  assertNoBuildMetadata(installedCoreDirectory);
  for (const schema of [
    "pptxlint.schema.json",
    "pptxlint-report.schema.json",
    "pptxlint-baseline.schema.json",
  ]) {
    assert.equal(
      existsSync(join(installedCoreDirectory, "dist/schemas", schema)),
      true,
      `${schema} must be present in the packed core package`,
    );
  }

  process.stdout.write("Packed CLI smoke test passed.\n");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function packPackage(command, args, packageDirectory, options = {}) {
  runCommand(command, args, {
    cwd: packageDirectory,
    ...options,
    stdio: "pipe",
  });
  const manifest = JSON.parse(
    readFileSync(join(packageDirectory, "package.json"), "utf8"),
  );
  const archiveName = `${manifest.name
    .replace(/^@/u, "")
    .replace("/", "-")}-${manifest.version}.tgz`;
  return resolve(packsDirectory, archiveName);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function inspectArchive(archivePath) {
  const listing = executeCommand("tar", ["-tf", archivePath], {
    cwd: workspaceRoot,
  });
  assert.equal(listing.status, 0, listing.stderr);
  const manifest = executeCommand(
    "tar",
    ["-xOf", archivePath, "package/package.json"],
    { cwd: workspaceRoot },
  );
  assert.equal(manifest.status, 0, manifest.stderr);
  return {
    entries: listing.stdout.trim().split(/\r?\n/u),
    manifest: JSON.parse(manifest.stdout),
  };
}

function assertPackedManifest(manifest, name, version) {
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, version);
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.author, "Mikhail Grankin");
  assert.equal(manifest.engines.node, "^22.13.0 || ^24.0.0");
  assert.equal(
    manifest.repository.url,
    "git+https://github.com/mikhailgitai/pptxlint.git",
  );
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal("provenance" in manifest.publishConfig, false);
}

function assertArchiveContents(entries, options) {
  for (const file of [
    "package/LICENSE",
    "package/NOTICE",
    "package/README.md",
    "package/package.json",
  ]) {
    assert.ok(entries.includes(file), `${file} must be present in the tarball`);
  }
  assert.equal(
    entries.some(
      (entry) =>
        entry.endsWith(".tsbuildinfo") ||
        entry.includes("/test/") ||
        entry.includes("/fixtures/"),
    ),
    false,
    "tarballs must exclude build metadata, tests, and fixtures",
  );
  if (options.schemas) {
    for (const schema of [
      "pptxlint.schema.json",
      "pptxlint-report.schema.json",
      "pptxlint-baseline.schema.json",
    ]) {
      assert.ok(
        entries.includes(`package/dist/schemas/${schema}`),
        `${schema} must be present in the core tarball`,
      );
    }
  }
  if (options.example) {
    for (const file of [
      "public-broken-deck.pptx",
      "public-broken-deck.expected.json",
      "public-broken-deck.expected.txt",
    ]) {
      assert.ok(
        entries.includes(`package/dist/examples/${file}`),
        `${file} must be present in the CLI tarball`,
      );
    }
  }
}

function assertPackageDocuments(packageDirectory) {
  for (const file of ["LICENSE", "NOTICE", "README.md"]) {
    assert.equal(
      existsSync(join(packageDirectory, file)),
      true,
      `${file} must be present in the packed package`,
    );
  }
}

function assertNoBuildMetadata(packageDirectory) {
  const buildMetadata = listFiles(packageDirectory).filter((path) =>
    path.endsWith(".tsbuildinfo"),
  );
  assert.deepEqual(buildMetadata, []);
}

function listFiles(directory, relativeDirectory = "") {
  const absoluteDirectory = join(directory, relativeDirectory);
  return readdirSync(absoluteDirectory).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry);
    return statSync(join(directory, relativePath)).isDirectory()
      ? listFiles(directory, relativePath)
      : [relativePath];
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function runCommand(command, args, options) {
  const invocation = portableInvocation(command, args);
  return execFileSync(invocation.command, invocation.args, options);
}

function executeCommand(command, args, options) {
  const invocation = portableInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    ...options,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function portableInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/c", command, ...args],
  };
}

async function buildMinimalPptx() {
  mkdirSync(fixtureBuildersDirectory, { recursive: true });
  writeFileSync(
    join(fixtureBuildersDirectory, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  );
  for (const file of ["raw-zip.ts", "pptx.ts"]) {
    const sourcePath = resolve(workspaceRoot, "fixtures/builders", file);
    const output = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
        verbatimModuleSyntax: true,
      },
      fileName: sourcePath,
    }).outputText;
    writeFileSync(
      join(fixtureBuildersDirectory, file.replace(/\.ts$/u, ".js")),
      output,
    );
  }
  const fixtureBuilder = await import(
    pathToFileURL(join(fixtureBuildersDirectory, "pptx.js")).href
  );
  return fixtureBuilder.buildMinimalPptx();
}
