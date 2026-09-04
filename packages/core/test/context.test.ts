import { describe, expect, it, vi } from "vitest";

import {
  buildMinimalPptx,
  buildRawZip,
  minimalPptxEntries,
  minimalSlideXml,
  OFFICE_RELATIONSHIPS_NAMESPACE,
  PACKAGE_RELATIONSHIPS_NAMESPACE,
  PRESENTATIONML_NAMESPACE,
} from "../../../fixtures/builders/index.js";
import {
  buildPptxContext,
  CONTENT_TYPES_NAMESPACE,
  HARD_ARCHIVE_SECURITY_LIMITS,
  STRICT_DRAWINGML_NAMESPACE,
  STRICT_PRESENTATIONML_NAMESPACE,
} from "../src/index.js";

describe("shared PPTX context", () => {
  it("builds content types, graph, presentation chain, shapes, and identity", async () => {
    const slideXml = minimalSlideXml().replace(
      "</p:spTree>",
      `<p:sp><p:nvSpPr><p:cNvPr id="8" name="Back"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr></p:sp>
       <p:pic><p:nvPicPr><p:cNvPr id="21" name="Front"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="100000" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr></p:pic>
       </p:spTree>`,
    );
    const built = await buildPptxContext(buildMinimalPptx({ slideXml }), {
      inputKey: "./decks\\minimal.pptx",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { context } = built;

    expect(context.analysisComplete).toBe(true);
    expect(context.identity.inputKey).toBe("decks/minimal.pptx");
    expect(context.identity.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(context.contentTypes.get("ppt/slides/slide1.xml")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    );
    expect(context.presentation).toMatchObject({
      partName: "ppt/presentation.xml",
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
    });
    expect(context.presentation?.slides).toEqual([
      expect.objectContaining({
        number: 1,
        persistentId: "256",
        partName: "ppt/slides/slide1.xml",
        layoutPart: "ppt/slideLayouts/slideLayout1.xml",
        masterPart: "ppt/slideMasters/slideMaster1.xml",
        themePart: "ppt/theme/theme1.xml",
        available: true,
        shapes: [
          {
            id: 8,
            name: "Back",
            kind: "shape",
            zIndex: 0,
            parentShapeId: null,
          },
          {
            id: 21,
            name: "Front",
            kind: "picture",
            zIndex: 1,
            parentShapeId: null,
          },
        ],
      }),
    ]);

    const reads = context.archive.stats.entryReads;
    const parses = context.xml.stats.parseAttempts;
    await context.xml.get("ppt/slides/slide1.xml");
    await context.xml.get("ppt/slides/slide1.xml");
    await context.archive.read("ppt/slides/slide1.xml");
    expect(context.archive.stats.entryReads).toBe(reads);
    expect(context.xml.stats.parseAttempts).toBe(parses);
    await context.close();
  });

  it("uses presentation order rather than sequential slide filenames", async () => {
    const entries = replaceEntries(minimalPptxEntries(minimalSlideXml()), {
      "ppt/presentation.xml": presentationXml([
        [900, "rId9"],
        [400, "rId2"],
      ]),
      "ppt/_rels/presentation.xml.rels": presentationRelationshipsXml(),
      "ppt/slides/quarterly.xml": minimalSlideXml(),
      "ppt/slides/_rels/quarterly.xml.rels": slideRelationshipsXml(),
    });
    const built = await buildPptxContext(buildRawZip(entries), {
      inputKey: "nonsequential.pptx",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(
      built.context.presentation?.slides.map((slide) => [
        slide.number,
        slide.persistentId,
        slide.partName,
      ]),
    ).toEqual([
      [1, "900", "ppt/slides/quarterly.xml"],
      [2, "400", "ppt/slides/slide1.xml"],
    ]);
    await built.context.close();
  });

  it("uses one ASCII-case-insensitive key across OPC indexes", async () => {
    const contentTypes = `<?xml version="1.0"?>
      <Types xmlns="${CONTENT_TYPES_NAMESPACE}">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/PPT/SLIDES/SLIDE1.XML" ContentType="application/x-case-override+xml"/>
      </Types>`;
    const rootRelationships = `<?xml version="1.0"?>
      <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
        <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/officeDocument" Target="PPT/PRESENTATION.XML"/>
      </Relationships>`;
    const presentationRelationships = presentationRelationshipsXml().replace(
      'Target="slides/slide1.xml"',
      'Target="SLIDES/SLIDE1.XML"',
    );
    const built = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "[Content_Types].xml": contentTypes,
          "_rels/.rels": rootRelationships,
          "ppt/_rels/presentation.xml.rels": presentationRelationships,
        }),
      ),
      { inputKey: "case-equivalence.pptx" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.context.analysisComplete).toBe(true);
    expect(built.context.archive.has("pPt/SlIdEs/SlIdE1.xMl")).toBe(true);
    expect(built.context.contentTypes.get("ppt/slides/slide1.xml")).toBe(
      "application/x-case-override+xml",
    );
    expect(built.context.presentation?.slides[0]?.partName).toBe(
      "ppt/SLIDES/SLIDE1.XML",
    );
    await built.context.close();
  });

  it("applies the XML ceiling to parameterized XML media types", async () => {
    const contentTypes = `<?xml version="1.0"?>
      <Types xmlns="${CONTENT_TYPES_NAMESPACE}">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/custom.data" ContentType="application/xml;charset=utf-8"/>
      </Types>`;
    const built = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "[Content_Types].xml": contentTypes,
          "custom.data": `<custom>${" ".repeat(2_500)}</custom>`,
        }),
      ),
      {
        inputKey: "parameterized-xml-media-type.pptx",
        archiveLimits: {
          maxPartUncompressedBytes: 4_000,
          maxXmlUncompressedBytes: 2_000,
        },
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.context.contentTypes.isXml("custom.data")).toBe(true);
    expect(built.context.archive.isXmlPart("custom.data")).toBe(true);
    await expect(
      built.context.archive.read("custom.data"),
    ).resolves.toMatchObject({ ok: false, code: "part-limit-exceeded" });
    await expect(built.context.xml.get("custom.data")).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "part-limit-exceeded" },
    });
    await built.context.close();
  });

  it("indexes shapes authored in the Strict PresentationML namespace", async () => {
    const strictSlide = `<?xml version="1.0"?>
      <p:sld xmlns:p="${STRICT_PRESENTATIONML_NAMESPACE}" xmlns:a="${STRICT_DRAWINGML_NAMESPACE}">
        <p:cSld>
          <p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr>
            <p:grpSpPr/>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="42" name="Strict Shape"/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`;
    const built = await buildPptxContext(
      buildMinimalPptx({ slideXml: strictSlide }),
      {
        inputKey: "strict-shapes.pptx",
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.context.analysisComplete).toBe(true);
    expect(built.context.presentation?.slides[0]?.shapes).toEqual([
      {
        id: 42,
        name: "Strict Shape",
        kind: "shape",
        zIndex: 0,
        parentShapeId: null,
      },
    ]);
    await built.context.close();
  });

  it("indexes external relationships without resolving or fetching them", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.reject(
        new Error("External relationships must never be fetched."),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const slideRels = `<?xml version="1.0"?>
      <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
        <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <Relationship Id="rId9" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" TargetMode="External" Target="https://example.invalid/image.png"/>
      </Relationships>`;
    const bytes = buildRawZip(
      replaceEntries(minimalPptxEntries(minimalSlideXml()), {
        "ppt/slides/_rels/slide1.xml.rels": slideRels,
      }),
    );
    try {
      const built = await buildPptxContext(bytes, {
        inputKey: "external.pptx",
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const external = built.context.relationships.getById(
        "ppt/slides/slide1.xml",
        "rId9",
      );
      expect(external).toMatchObject({
        targetMode: "external",
        rawTarget: "https://example.invalid/image.png",
        resolvedTarget: null,
        targetExists: null,
      });
      expect(built.context.analysisComplete).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      await built.context.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps missing media as graph data without treating it as a prerequisite", async () => {
    const slideRels = `<?xml version="1.0"?>
      <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
        <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/missing.png"/>
      </Relationships>`;
    const built = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "ppt/slides/_rels/slide1.xml.rels": slideRels,
        }),
      ),
      { inputKey: "missing-media.pptx" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(
      built.context.relationships.getById("ppt/slides/slide1.xml", "rId8"),
    ).toMatchObject({
      resolvedTarget: "ppt/media/missing.png",
      targetExists: false,
    });
    expect(built.context.analysisComplete).toBe(true);
    await built.context.close();
  });

  it("returns partial context for missing and malformed prerequisites", async () => {
    const missingLayout = buildRawZip(
      minimalPptxEntries(minimalSlideXml()).filter(
        ({ name }) => name !== "ppt/slideLayouts/slideLayout1.xml",
      ),
    );
    const missing = await buildPptxContext(missingLayout, {
      inputKey: "missing-layout.pptx",
    });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(missing.context.analysisComplete).toBe(false);
      expect(missing.context.presentation?.slides[0]).toMatchObject({
        partName: "ppt/slides/slide1.xml",
        layoutPart: null,
        shapes: [],
      });
      expect(missing.context.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "missing-presentation-target" }),
        ]),
      );
      await missing.context.close();
    }

    const missingMaster = await buildPptxContext(
      buildRawZip(
        minimalPptxEntries(minimalSlideXml()).filter(
          ({ name }) => name !== "ppt/slideMasters/slideMaster1.xml",
        ),
      ),
      { inputKey: "missing-master.pptx" },
    );
    expect(missingMaster.ok).toBe(true);
    if (missingMaster.ok) {
      expect(missingMaster.context.presentation?.slides[0]).toMatchObject({
        layoutPart: "ppt/slideLayouts/slideLayout1.xml",
        masterPart: null,
        themePart: null,
      });
      await missingMaster.context.close();
    }

    const malformed = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "ppt/slides/_rels/slide1.xml.rels": "<Relationships>",
        }),
      ),
      { inputKey: "malformed-rels.pptx" },
    );
    expect(malformed.ok).toBe(true);
    if (malformed.ok) {
      expect(malformed.context.presentation?.slides[0]?.available).toBe(true);
      expect(malformed.context.analysisComplete).toBe(false);
      expect(malformed.context.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "malformed-xml",
            partName: "ppt/slides/_rels/slide1.xml.rels",
          }),
        ]),
      );
      await malformed.context.close();
    }

    const malformedContentTypes = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "[Content_Types].xml": "<Types>",
        }),
      ),
      { inputKey: "malformed-content-types.pptx" },
    );
    expect(malformedContentTypes.ok).toBe(true);
    if (malformedContentTypes.ok) {
      expect(malformedContentTypes.context.presentation?.slides).toHaveLength(
        1,
      );
      expect(malformedContentTypes.context.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-content-types",
            partName: "[Content_Types].xml",
          }),
        ]),
      );
      await malformedContentTypes.context.close();
    }
  });

  it("rejects lookalike officeDocument and slide relationship types", async () => {
    const attackerRoot = `<?xml version="1.0"?>
      <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
        <Relationship Id="rId1" Type="https://attacker.invalid/officeDocument" Target="ppt/presentation.xml"/>
      </Relationships>`;
    const rootBuilt = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "_rels/.rels": attackerRoot,
        }),
      ),
      { inputKey: "invalid-root-type.pptx" },
    );
    expect(rootBuilt.ok).toBe(true);
    if (rootBuilt.ok) {
      expect(rootBuilt.context.presentation).toBeNull();
      expect(rootBuilt.context.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "missing-office-document" }),
        ]),
      );
      await rootBuilt.context.close();
    }

    const attackerSlideRelationships = presentationRelationshipsXml().replace(
      `${OFFICE_RELATIONSHIPS_NAMESPACE}/slide"`,
      'https://attacker.invalid/slide"',
    );
    const slideBuilt = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "ppt/_rels/presentation.xml.rels": attackerSlideRelationships,
        }),
      ),
      { inputKey: "invalid-slide-type.pptx" },
    );
    expect(slideBuilt.ok).toBe(true);
    if (slideBuilt.ok) {
      expect(slideBuilt.context.presentation?.slides[0]).toMatchObject({
        partName: null,
        available: false,
      });
      expect(slideBuilt.context.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "missing-presentation-relationship",
            relationshipId: "rId2",
          }),
        ]),
      );
      await slideBuilt.context.close();
    }
  });

  it.each([
    [
      "layout",
      "ppt/slideLayouts/slideLayout1.xml",
      { layoutPart: null, masterPart: null, themePart: null },
    ],
    [
      "master",
      "ppt/slideMasters/slideMaster1.xml",
      {
        layoutPart: "ppt/slideLayouts/slideLayout1.xml",
        masterPart: null,
        themePart: null,
      },
    ],
    [
      "theme",
      "ppt/theme/theme1.xml",
      {
        layoutPart: "ppt/slideLayouts/slideLayout1.xml",
        masterPart: "ppt/slideMasters/slideMaster1.xml",
        themePart: null,
      },
    ],
  ] as const)(
    "rejects a well-formed %s part with the wrong root",
    async (_kind, partName, expectedChain) => {
      const built = await buildPptxContext(
        buildRawZip(
          replaceEntries(minimalPptxEntries(minimalSlideXml()), {
            [partName]: "<not-the-expected-root/>",
          }),
        ),
        { inputKey: `invalid-${_kind}-root.pptx` },
      );
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      expect(built.context.analysisComplete).toBe(false);
      expect(built.context.presentation?.slides[0]).toMatchObject(
        expectedChain,
      );
      expect(built.context.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-presentation",
            partName,
          }),
        ]),
      );
      await built.context.close();
    },
  );

  it("diagnoses incomplete content-type declarations", async () => {
    const invalidContentTypes = `<?xml version="1.0"?>
      <Types xmlns="${CONTENT_TYPES_NAMESPACE}">
        <Default ContentType="application/xml"/>
        <Override PartName="/ppt/presentation.xml"/>
      </Types>`;
    const built = await buildPptxContext(
      buildRawZip(
        replaceEntries(minimalPptxEntries(minimalSlideXml()), {
          "[Content_Types].xml": invalidContentTypes,
        }),
      ),
      { inputKey: "invalid-content-type-declarations.pptx" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.context.analysisComplete).toBe(false);
    expect(
      built.context.diagnostics.filter(
        (diagnostic) => diagnostic.code === "invalid-content-types",
      ),
    ).toHaveLength(2);
    await built.context.close();
  });

  it("rejects unsafe archive overrides through the public context API", async () => {
    await expect(
      buildPptxContext(buildMinimalPptx(), {
        inputKey: "unsafe-limits.pptx",
        archiveLimits: { maxCompressionRatio: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      buildPptxContext(buildMinimalPptx(), {
        inputKey: "above-ceiling.pptx",
        archiveLimits: {
          maxXmlUncompressedBytes:
            HARD_ARCHIVE_SECURITY_LIMITS.maxXmlUncompressedBytes + 1,
        },
      }),
    ).rejects.toThrow(RangeError);
  });

  it("detects canonical conflicts and applies size limits before reading", async () => {
    const bytes = buildMinimalPptx({
      additionalEntries: [
        { name: "ppt/slides/./slide1.xml", data: minimalSlideXml() },
        { name: "../outside.xml", data: "<outside/>" },
      ],
    });
    const built = await buildPptxContext(bytes, {
      inputKey: "unsafe.pptx",
      archiveLimits: { maxPartUncompressedBytes: 200 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.context.archive.duplicates()).toContain(
      "ppt/slides/slide1.xml",
    );
    expect(built.context.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous-part-name" }),
        expect.objectContaining({ code: "archive-limit-exceeded" }),
        expect.objectContaining({ code: "invalid-part-name" }),
      ]),
    );
    await expect(
      built.context.archive.read("ppt/presentation.xml"),
    ).resolves.toMatchObject({ ok: false, code: "part-limit-exceeded" });
    await built.context.close();
  });
});

function replaceEntries(
  entries: ReturnType<typeof minimalPptxEntries>,
  replacements: Readonly<Record<string, string>>,
): ReturnType<typeof minimalPptxEntries> {
  const names = new Set(entries.map((entry) => entry.name));
  return [
    ...entries.map((entry) => ({
      ...entry,
      data: replacements[entry.name] ?? entry.data,
    })),
    ...Object.entries(replacements)
      .filter(([name]) => !names.has(name))
      .map(([name, data]) => ({ name, data })),
  ];
}

function presentationXml(
  slides: readonly (readonly [number, string])[],
): string {
  return `<?xml version="1.0"?>
    <p:presentation xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}">
      <p:sldIdLst>${slides
        .map(
          ([id, relationshipId]) =>
            `<p:sldId id="${String(id)}" r:id="${relationshipId}"/>`,
        )
        .join("")}</p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`;
}

function presentationRelationshipsXml(): string {
  return `<?xml version="1.0"?>
    <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
      <Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId9" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slide" Target="slides/quarterly.xml"/>
    </Relationships>`;
}

function slideRelationshipsXml(): string {
  return `<?xml version="1.0"?>
    <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>`;
}
