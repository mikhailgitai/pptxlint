import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(workspaceRoot, "examples/public-broken-deck.pptx");
const temporaryRoot = mkdtempSync(join(tmpdir(), "pptxlint-public-example-"));

try {
  const fixtureBuilder = await loadFixtureBuilder();
  const slideXml = fixtureBuilder.minimalSlideXml().replace(
    "</p:spTree>",
    `${textShape({
      id: 2,
      name: "Body text below minimum",
      x: 700_000,
      y: 600_000,
      width: 4_000_000,
      height: 900_000,
      runProperties: '<a:rPr sz="900"/>',
      text: "This body text is only 9pt.",
    })}${textShape({
      id: 3,
      name: "Over-compressed autofit",
      x: 700_000,
      y: 2_000_000,
      width: 4_000_000,
      height: 900_000,
      autofit: '<a:normAutofit fontScale="40000"/>',
      runProperties: '<a:rPr sz="2400"/>',
      text: "Stored autofit scales this 24pt text to 9.6pt.",
    })}${textShape({
      id: 4,
      name: "Shape outside slide",
      x: 11_700_000,
      y: 4_500_000,
      width: 1_500_000,
      height: 900_000,
      runProperties: '<a:rPr sz="1800"/>',
      text: "Partly outside",
    })}</p:spTree>`,
  );
  const bytes = fixtureBuilder.buildMinimalPptx({ slideXml });

  if (process.argv.includes("--check")) {
    assert.equal(
      Buffer.compare(readFileSync(outputPath), Buffer.from(bytes)),
      0,
      "examples/public-broken-deck.pptx is not reproducible; run pnpm example:build",
    );
    process.stdout.write("Public broken deck is reproducible.\n");
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, bytes);
    process.stdout.write(`Wrote ${outputPath}\n`);
  }
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

async function loadFixtureBuilder() {
  writeFileSync(
    join(temporaryRoot, "package.json"),
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
    writeFileSync(join(temporaryRoot, file.replace(/\.ts$/u, ".js")), output);
  }
  return import(pathToFileURL(join(temporaryRoot, "pptx.js")).href);
}

function textShape(options) {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${String(options.id)}" name="${options.name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${String(options.x)}" y="${String(options.y)}"/><a:ext cx="${String(options.width)}" cy="${String(options.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    <p:txBody><a:bodyPr>${options.autofit ?? ""}</a:bodyPr><a:lstStyle/><a:p><a:r>${options.runProperties}<a:t>${options.text}</a:t></a:r></a:p></p:txBody>
  </p:sp>`;
}
