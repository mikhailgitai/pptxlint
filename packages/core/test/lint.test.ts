import { describe, expect, it } from "vitest";

import {
  buildMinimalPptx,
  buildRawZip,
  minimalPptxEntries,
  minimalSlideXml,
  OFFICE_RELATIONSHIPS_NAMESPACE,
  PACKAGE_RELATIONSHIPS_NAMESPACE,
} from "../../../fixtures/builders/index.js";
import {
  ConfigError,
  determineExitCode,
  lintPptx,
  MICROSOFT_MEDIA_RELATIONSHIP,
  resolveConfig,
  VML_DRAWING_CONTENT_TYPE,
} from "../src/index.js";

describe("lint engine and package rules", () => {
  it("returns a complete empty report for a valid minimal presentation", async () => {
    const report = await lint(buildMinimalPptx(), "valid.pptx");

    expect(report).toMatchObject({
      schemaVersion: 1,
      analysisComplete: true,
      findings: [],
      skippedRules: [],
      summary: { errors: 0, warnings: 0, total: 0 },
    });
    expect(report.input.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(determineExitCode(report, "error")).toBe(0);
  });

  it("reports a missing non-media target with exact relationship evidence", async () => {
    const bytes = withSlideRelationships(`
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId7" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/notesSlide" Target="../notesSlides/missing.xml"/>
    `);
    const report = await lint(bytes, "broken.pptx");

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: "package/broken-relationship",
      severity: "error",
      location: { part: "ppt/slides/slide1.xml" },
      evidence: {
        sourcePart: "ppt/slides/slide1.xml",
        relationshipPart: "ppt/slides/_rels/slide1.xml.rels",
        relationshipId: "rId7",
        rawTarget: "../notesSlides/missing.xml",
        resolvedTarget: "ppt/notesSlides/missing.xml",
      },
    });
    expect(report.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(determineExitCode(report, "error")).toBe(1);
  });

  it("specializes missing media without a broken-relationship duplicate", async () => {
    const bytes = withSlideRelationships(`
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/missing.png"/>
    `);
    const report = await lint(bytes, "missing-media.pptx");

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: "package/missing-media",
      location: {
        part: "ppt/slides/slide1.xml",
        slideId: "256",
        slideNumber: 1,
      },
      evidence: {
        mediaKind: "image",
        referencingSlide: 1,
        relationshipId: "rId8",
        resolvedTarget: "ppt/media/missing.png",
      },
    });
  });

  it.each(["audio", "video"] as const)(
    "recognizes missing %s relationship targets",
    async (mediaKind) => {
      const bytes = withSlideRelationships(`
        <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/${mediaKind}" Target="../media/missing.bin"/>
      `);

      const report = await lint(bytes, `missing-${mediaKind}.pptx`);

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]).toMatchObject({
        ruleId: "package/missing-media",
        evidence: { mediaKind },
      });
    },
  );

  it("classifies the Microsoft Media Part relationship as missing media", async () => {
    const bytes = withSlideRelationships(`
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId8" Type="${MICROSOFT_MEDIA_RELATIONSHIP}" Target="../media/missing.mp4"/>
    `);
    const report = await lintPptx(
      {
        bytes,
        displayPath: "microsoft-media.pptx",
        inputKey: "microsoft-media.pptx",
      },
      {
        config: resolveConfig({
          extends: ["recommended"],
          rules: { "package/broken-relationship": "off" },
        }),
      },
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: "package/missing-media",
      evidence: { mediaKind: "media", relationshipId: "rId8" },
    });
  });

  it("ignores external relationships", async () => {
    const bytes = withSlideRelationships(`
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId9" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" TargetMode="External" Target="https://example.invalid/image.png"/>
    `);

    expect((await lint(bytes, "external.pptx")).findings).toEqual([]);
  });

  it("turns malformed XML into one deterministic partial-report finding", async () => {
    const bytes = buildMinimalPptx({ slideXml: "<p:sld>" });
    const first = await lint(bytes, "malformed.pptx");
    const second = await lint(bytes, "malformed.pptx");

    expect(first.analysisComplete).toBe(false);
    expect(first.findings).toHaveLength(1);
    expect(first.findings[0]).toMatchObject({
      ruleId: "package/malformed-xml",
      location: { part: "ppt/slides/slide1.xml" },
      evidence: {
        diagnosticCode: "malformed-xml",
        partName: "ppt/slides/slide1.xml",
      },
    });
    expect(first.findings).toEqual(second.findings);
    expect(determineExitCode(first, "error")).toBe(1);
  });

  it("includes content-type-designated VML in malformed XML analysis", async () => {
    const partName = "ppt/drawings/vmlDrawing1.vml";
    const entries = minimalPptxEntries(minimalSlideXml()).map((entry) =>
      entry.name === "[Content_Types].xml"
        ? {
            ...entry,
            data: entryText(entry.data).replace(
              "</Types>",
              `<Override PartName="/${partName}" ContentType="${VML_DRAWING_CONTENT_TYPE}"/></Types>`,
            ),
          }
        : entry,
    );
    const report = await lint(
      buildRawZip([...entries, { name: partName, data: "<xml>" }]),
      "malformed-vml.pptx",
    );

    expect(report.analysisComplete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: "package/malformed-xml",
      location: { part: partName },
    });
    expect(determineExitCode(report, "error")).toBe(1);
  });

  it("returns code 2 when a gating finding does not explain every diagnostic", async () => {
    const entries = replaceEntries(minimalPptxEntries(minimalSlideXml()), {
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0"?>
          <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
            <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
            <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/missing.png"/>
          </Relationships>`,
    }).map((entry) =>
      entry.name === "[Content_Types].xml"
        ? {
            ...entry,
            data: entryText(entry.data).replace(
              "</Types>",
              '<Default Extension="xml" ContentType="application/xml"/></Types>',
            ),
          }
        : entry,
    );
    const report = await lint(
      buildRawZip(entries),
      "unexplained-diagnostic.pptx",
    );

    expect(report.findings).toEqual([
      expect.objectContaining({ ruleId: "package/missing-media" }),
    ]);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-content-type" }),
      ]),
    );
    expect(determineExitCode(report, "error")).toBe(2);
  });

  it("returns code 1 when a gating relationship finding explains incompleteness", async () => {
    const report = await lint(
      buildRawZip(
        minimalPptxEntries(minimalSlideXml()).filter(
          (entry) => entry.name !== "ppt/presentation.xml",
        ),
      ),
      "missing-presentation.pptx",
    );

    expect(report.analysisComplete).toBe(false);
    expect(report.findings).toEqual([
      expect.objectContaining({ ruleId: "package/broken-relationship" }),
    ]);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-presentation-part" }),
      ]),
    );
    expect(determineExitCode(report, "error")).toBe(1);
  });

  it.each([
    [
      "slide",
      "ppt/slides/_rels/slide1.xml.rels",
      "missing-presentation-relationship",
    ],
    ["root", "_rels/.rels", "missing-office-document"],
  ] as const)(
    "treats cascade diagnostics from malformed %s relationships as explained",
    async (_caseName, relationshipsPart, cascadeCode) => {
      const report = await lint(
        buildRawZip(
          replaceEntries(minimalPptxEntries(minimalSlideXml()), {
            [relationshipsPart]: "<Relationships>",
          }),
        ),
        `malformed-${_caseName}-relationships.pptx`,
      );

      expect(report.findings).toEqual([
        expect.objectContaining({
          ruleId: "package/malformed-xml",
          location: { part: relationshipsPart },
        }),
      ]);
      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: cascadeCode }),
        ]),
      );
      expect(determineExitCode(report, "error")).toBe(1);
    },
  );

  it("keeps fingerprints stable across severity overrides", async () => {
    const bytes = withSlideRelationships(`
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/video" Target="../media/missing.mp4"/>
    `);
    const errors = await lint(bytes, "severity.pptx");
    const warnings = await lintPptx(
      {
        bytes,
        displayPath: "severity.pptx",
        inputKey: "severity.pptx",
      },
      {
        config: resolveConfig({
          extends: ["recommended"],
          rules: { "package/missing-media": "warning" },
        }),
      },
    );

    expect(warnings.findings[0]?.severity).toBe("warning");
    expect(warnings.findings[0]?.fingerprint).toBe(
      errors.findings[0]?.fingerprint,
    );
    expect(determineExitCode(warnings, "error")).toBe(0);
    expect(determineExitCode(warnings, "warning")).toBe(1);
  });
});

describe("configuration", () => {
  it("resolves the recommended preset and rule overrides", () => {
    const config = resolveConfig({
      extends: ["recommended"],
      failOn: "warning",
      rules: { "package/missing-media": "off" },
    });

    expect(config.failOn).toBe("warning");
    expect(config.rules.get("package/broken-relationship")).toMatchObject({
      enabled: true,
      severity: "error",
    });
    expect(config.rules.get("package/missing-media")).toMatchObject({
      enabled: false,
    });
    expect(config.rules.get("layout/text-overlap")).toMatchObject({
      enabled: true,
      severity: "warning",
    });
    expect(config.rules.get("layout/text-occluded")).toMatchObject({
      enabled: false,
    });
  });

  it.each([
    [{ rules: { "unknown/rule": "error" } }, "Unknown rule"],
    [
      {
        rules: {
          "package/missing-media": ["error", { unexpected: true }],
        },
      },
      "unknown option",
    ],
    [{ failOn: "off" }, "failOn"],
    [
      { rules: { "package/missing-media": ["error", null] } },
      "options must be an object",
    ],
    [{ extra: true }, "Unknown config property"],
  ])("rejects invalid config %#", (value, message) => {
    expect(() => resolveConfig(value)).toThrow(ConfigError);
    expect(() => resolveConfig(value)).toThrow(message);
  });
});

async function lint(bytes: Uint8Array, file: string) {
  return lintPptx(
    { bytes, displayPath: file, inputKey: file },
    { config: resolveConfig() },
  );
}

function withSlideRelationships(relationships: string): Uint8Array {
  return buildRawZip(
    replaceEntries(minimalPptxEntries(minimalSlideXml()), {
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0"?>
        <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
          ${relationships}
        </Relationships>`,
    }),
  );
}

function replaceEntries(
  entries: ReturnType<typeof minimalPptxEntries>,
  replacements: Readonly<Record<string, string>>,
) {
  return entries.map((entry) => ({
    ...entry,
    data: replacements[entry.name] ?? entry.data,
  }));
}

function entryText(data: string | Uint8Array): string {
  if (typeof data !== "string") {
    throw new TypeError("Expected a textual fixture entry.");
  }
  return data;
}
