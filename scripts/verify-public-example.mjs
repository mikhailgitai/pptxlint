import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = "examples/public-broken-deck.pptx";
const expectedJsonPath = resolve(
  workspaceRoot,
  "examples/public-broken-deck.expected.json",
);
const expectedStylishPath = resolve(
  workspaceRoot,
  "examples/public-broken-deck.expected.txt",
);

const reproduction = execute(
  process.execPath,
  ["scripts/build-public-example.mjs", "--check"],
  workspaceRoot,
);
assert.equal(
  reproduction.status,
  0,
  reproduction.stderr || reproduction.stdout,
);

const json = execute(
  process.execPath,
  ["packages/cli/dist/cli.js", inputPath, "--format", "json"],
  workspaceRoot,
);
assert.equal(json.status, 1, json.stderr || json.stdout);
assert.equal(json.stderr, "");

const stylish = execute(
  process.execPath,
  ["packages/cli/dist/cli.js", inputPath],
  workspaceRoot,
);
assert.equal(stylish.status, 1, stylish.stderr || stylish.stdout);
assert.equal(stylish.stderr, "");
assert.equal(stylish.stdout.endsWith("\n\n"), true);
const normalizedStylish = `${stylish.stdout.trimEnd()}\n`;

if (process.argv.includes("--update")) {
  JSON.parse(json.stdout);
  writeFileSync(expectedJsonPath, json.stdout);
  writeFileSync(expectedStylishPath, normalizedStylish);
  process.stdout.write("Updated public example reports.\n");
} else {
  assert.deepEqual(JSON.parse(json.stdout), readJson(expectedJsonPath));
  assert.equal(normalizedStylish, readFileSync(expectedStylishPath, "utf8"));
  process.stdout.write("Public example report matches expected output.\n");
}

function execute(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
