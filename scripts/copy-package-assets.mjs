import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = resolve(workspaceRoot, "packages/core/dist/schemas");
const exampleDirectory = resolve(workspaceRoot, "packages/cli/dist/examples");

for (const packageDirectory of ["cli", "core"]) {
  rmSync(
    resolve(workspaceRoot, "packages", packageDirectory, "dist/.tsbuildinfo"),
    { force: true },
  );
}

mkdirSync(schemaDirectory, { recursive: true });
mkdirSync(exampleDirectory, { recursive: true });

for (const file of [
  "pptxlint.schema.json",
  "pptxlint-report.schema.json",
  "pptxlint-baseline.schema.json",
]) {
  copyFileSync(
    resolve(workspaceRoot, "schemas", file),
    resolve(schemaDirectory, file),
  );
}

for (const file of [
  "public-broken-deck.pptx",
  "public-broken-deck.expected.json",
  "public-broken-deck.expected.txt",
]) {
  copyFileSync(
    resolve(workspaceRoot, "examples", file),
    resolve(exampleDirectory, file),
  );
}
