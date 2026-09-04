import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const SLIDE_COUNT = 100;
const TARGET_BYTES = 50 * 1024 * 1024;
const workspaceRoot = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), "pptxlint-benchmark-"));
const transpiledBuilders = join(temporaryRoot, "fixture-builders");

try {
  const builders = await loadFixtureBuilders();
  const bytes = buildBenchmarkPptx(builders);
  assert.ok(bytes.byteLength >= TARGET_BYTES);
  const fixturePath = join(temporaryRoot, "benchmark-100-slides.pptx");
  writeFileSync(fixturePath, bytes);

  const executable = resolve(workspaceRoot, "packages/cli/dist/cli.js");
  const result = spawnSync(
    process.execPath,
    [executable, fixturePath, "--format", "json", "--debug"],
    { cwd: temporaryRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  const report = JSON.parse(result.stdout);
  assert.equal(report.analysisComplete, true);
  assert.equal(report.inputs.length, 1);
  assert.equal(report.summary.total, 0);
  assert.ok(report.timingsMs.analysis >= 0);
  assert.ok(report.peakRssBytes > 0);

  process.stdout.write(
    `${JSON.stringify(
      {
        benchmarkVersion: 1,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        inputBytes: bytes.byteLength,
        slideCount: SLIDE_COUNT,
        analysisMs: report.timingsMs.analysis,
        peakRssBytes: report.peakRssBytes,
        ruleTimingsMs: Object.fromEntries(
          Object.entries(report.timingsMs).filter(([name]) =>
            name.startsWith("rule/"),
          ),
        ),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

async function loadFixtureBuilders() {
  mkdirSync(transpiledBuilders, { recursive: true });
  writeFileSync(
    join(transpiledBuilders, "package.json"),
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
      join(transpiledBuilders, file.replace(/\.ts$/u, ".js")),
      output,
    );
  }
  const [pptx, rawZip] = await Promise.all([
    import(pathToFileURL(join(transpiledBuilders, "pptx.js")).href),
    import(pathToFileURL(join(transpiledBuilders, "raw-zip.js")).href),
  ]);
  return { ...pptx, ...rawZip };
}

function buildBenchmarkPptx(builders) {
  const baseEntries = builders.minimalPptxEntries(builders.minimalSlideXml());
  const retainedEntries = baseEntries.filter(
    ({ name }) =>
      name !== "[Content_Types].xml" &&
      name !== "ppt/presentation.xml" &&
      name !== "ppt/_rels/presentation.xml.rels" &&
      name !== "ppt/slides/slide1.xml" &&
      name !== "ppt/slides/_rels/slide1.xml.rels",
  );
  const slideEntries = [];
  for (let slide = 1; slide <= SLIDE_COUNT; slide += 1) {
    slideEntries.push(
      {
        name: `ppt/slides/slide${slide}.xml`,
        data: builders.minimalSlideXml(),
      },
      {
        name: `ppt/slides/_rels/slide${slide}.xml.rels`,
        data: slideRelationshipsXml(),
      },
    );
  }
  return builders.buildRawZip([
    { name: "[Content_Types].xml", data: contentTypesXml() },
    ...retainedEntries,
    { name: "ppt/presentation.xml", data: presentationXml() },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: presentationRelationshipsXml(),
    },
    ...slideEntries,
    {
      name: "ppt/media/benchmark-padding.bin",
      data: new Uint8Array(TARGET_BYTES),
    },
  ]);
}

function contentTypesXml() {
  const slideOverrides = Array.from(
    { length: SLIDE_COUNT },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="bin" ContentType="application/octet-stream"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;
}

function presentationXml() {
  const slideIds = Array.from(
    { length: SLIDE_COUNT },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`;
}

function presentationRelationshipsXml() {
  const slideRelationships = Array.from(
    { length: SLIDE_COUNT },
    (_, index) =>
      `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRelationships}
  <Relationship Id="rId${SLIDE_COUNT + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>
</Relationships>`;
}

function slideRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}
