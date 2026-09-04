import { describe, expect, it } from "vitest";

import {
  buildMinimalPptx,
  buildRawZip,
  minimalPptxEntries,
  minimalSlideXml,
} from "../../../fixtures/builders/index.js";
import {
  ConfigError,
  determineExitCode,
  lintPptx,
  resolveConfig,
} from "../src/index.js";

const SLIDE_WIDTH = 12_192_000;
const SLIDE_HEIGHT = 6_858_000;

describe("layout/outside-slide", () => {
  it("resolves a local placeholder through layout and master geometry", async () => {
    const slideXml = slideWith(
      placeholderShape({
        id: 8,
        name: "Inherited placeholder",
        index: 7,
        type: "body",
        text: "Inherited text",
      }),
    );
    const layoutPlaceholder = placeholderShape({
      id: 70,
      name: "Layout placeholder",
      index: 7,
      type: "body",
      text: "",
    });
    const masterPlaceholder = placeholderShape({
      id: 71,
      name: "Master placeholder",
      index: 7,
      type: "body",
      text: "",
      x: SLIDE_WIDTH - 100_000,
      y: 100_000,
      width: 500_000,
      height: 500_000,
    });
    const report = await lintBytes(
      pptxWithTemplateShapes(slideXml, layoutPlaceholder, masterPlaceholder),
      "inherited-placeholder.pptx",
    );

    expect(report.analysisComplete).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(
      report.findings.find(
        (finding) =>
          finding.ruleId === "layout/outside-slide" &&
          finding.location.shapeIds?.includes(8) === true,
      ),
    ).toMatchObject({ location: { shapeIds: [8] } });
  });

  it("does not match layout and master placeholders by idx across incompatible types", async () => {
    const slidePlaceholder = placeholderShape({
      id: 8,
      name: "Slide picture placeholder",
      index: 5,
      type: "pic",
      text: "Picture caption",
    });
    const layoutPlaceholder = placeholderShape({
      id: 50,
      name: "Layout picture placeholder",
      index: 5,
      type: "pic",
      text: "",
    });
    const masterFooter = placeholderShape({
      id: 51,
      name: "Master footer",
      index: 5,
      type: "ftr",
      text: "",
      x: SLIDE_WIDTH,
      y: 0,
      width: 1_000_000,
      height: 1_000_000,
    });
    const report = await lintBytes(
      pptxWithTemplateShapes(
        slideWith(slidePlaceholder),
        layoutPlaceholder,
        masterFooter,
      ),
      "incompatible-master-placeholder.pptx",
    );

    expect(report.analysisComplete).toBe(false);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported-geometry" }),
    ]);
    expect(report.findings).toEqual([]);
    expect(determineExitCode(report, "error")).toBe(2);
  });

  it("marks an unresolved local placeholder as incomplete", async () => {
    const report = await lint(
      slideWith(
        placeholderShape({
          id: 8,
          name: "Unresolved placeholder",
          index: 999,
          type: "body",
          text: "Text",
        }),
      ),
      "unresolved-placeholder.pptx",
    );

    expect(report.analysisComplete).toBe(false);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported-geometry",
        partName: "ppt/slides/slide1.xml",
      }),
    ]);
    expect(determineExitCode(report, "error")).toBe(2);
  });

  it("reports basic off-slide geometry with bounds, clipping, and ratio evidence", async () => {
    const report = await lint(
      slideWith(
        textShape({
          id: 8,
          name: "Off right",
          x: SLIDE_WIDTH - 100_000,
          y: 100_000,
          width: 500_000,
          height: 500_000,
        }),
      ),
      "outside.pptx",
    );

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "layout/outside-slide",
    );
    expect(finding).toMatchObject({
      severity: "warning",
      location: {
        slideNumber: 1,
        slideId: "256",
        shapeIds: [8],
      },
      evidence: {
        affectedEdges: ["right"],
        boundsEmu: {
          x: SLIDE_WIDTH - 100_000,
          y: 100_000,
          width: 500_000,
          height: 500_000,
        },
        intersectionAreaEmu2: 50_000_000_000,
        outsideRatio: 0.8,
        tolerancePt: 2,
      },
    });
  });

  it("accepts exact full-bleed geometry and the configured tolerance boundary", async () => {
    const exactBleed = await lint(
      slideWith(
        pictureShape({
          id: 2,
          name: "Background",
          x: 0,
          y: 0,
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
        }),
      ),
      "full-bleed.pptx",
    );
    const atTolerance = await lint(
      slideWith(
        textShape({
          id: 3,
          name: "At tolerance",
          x: SLIDE_WIDTH - 100_000,
          y: 0,
          width: 125_400,
          height: 500_000,
        }),
      ),
      "tolerance.pptx",
    );

    expect(exactBleed.findings).toEqual([]);
    expect(atTolerance.findings).toEqual([]);
  });

  it("uses transformed polygons for rotated and grouped shapes", async () => {
    const rotated = await lint(
      slideWith(
        textShape({
          id: 4,
          name: "Rotated",
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
          rotation: 45,
        }),
      ),
      "rotated.pptx",
    );
    const grouped = await lint(
      slideWith(`
        <p:grpSp>
          <p:nvGrpSpPr><p:cNvPr id="10" name="Group"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm>
            <a:off x="${String(SLIDE_WIDTH - 200_000)}" y="100000"/>
            <a:ext cx="400000" cy="400000"/>
            <a:chOff x="0" y="0"/><a:chExt cx="200000" cy="200000"/>
          </a:xfrm></p:grpSpPr>
          ${textShape({ id: 11, name: "Grouped", x: 0, y: 0, width: 200_000, height: 200_000 })}
        </p:grpSp>`),
      "grouped.pptx",
    );

    expect(
      rotated.findings.filter(
        (finding) => finding.ruleId === "layout/outside-slide",
      ),
    ).toHaveLength(1);
    expect(
      grouped.findings.find(
        (finding) => finding.ruleId === "layout/outside-slide",
      ),
    ).toMatchObject({ location: { shapeIds: [11] } });
  });

  it("does not inspect layout/master decorations", async () => {
    const layoutWithDecoration = minimalPptxEntries(minimalSlideXml()).map(
      (entry) =>
        entry.name === "ppt/slideLayouts/slideLayout1.xml" &&
        typeof entry.data === "string"
          ? {
              ...entry,
              data: entry.data.replace(
                "</p:spTree>",
                `${textShape({ id: 90, name: "Layout decoration", x: SLIDE_WIDTH, y: 0, width: 1_000_000, height: 1_000_000 })}</p:spTree>`,
              ),
            }
          : entry,
    );

    expect(
      (await lintBytes(buildRawZip(layoutWithDecoration), "inherited.pptx"))
        .findings,
    ).toEqual([]);
  });

  it("ignores hidden shapes and complete hidden group subtrees", async () => {
    const report = await lint(
      slideWith(
        pictureShape({
          id: 20,
          name: "Hidden outside picture",
          hidden: true,
          x: SLIDE_WIDTH,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
        `<p:grpSp>
          <p:nvGrpSpPr><p:cNvPr id="30" name="Hidden group" hidden="1"/></p:nvGrpSpPr>
          <p:grpSpPr/>
          ${textShape({ id: 31, name: "Hidden child", x: SLIDE_WIDTH, y: 0, width: 1_000_000, height: 1_000_000 })}
        </p:grpSp>`,
      ),
      "hidden-outside.pptx",
    );

    expect(report.analysisComplete).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(report.findings).toEqual([]);
  });
});

describe("layout/text-overlap", () => {
  it("uses layout geometry for a text-bearing slide placeholder", async () => {
    const inherited = placeholderShape({
      id: 8,
      name: "Slide title",
      index: 2,
      type: "title",
      text: "Inherited frame",
    });
    const local = textShape({
      id: 9,
      name: "Local text",
      x: 500_000,
      y: 500_000,
      width: 1_000_000,
      height: 1_000_000,
    });
    const layout = placeholderShape({
      id: 80,
      name: "Layout title",
      index: 2,
      type: "title",
      text: "",
      x: 500_000,
      y: 500_000,
      width: 1_000_000,
      height: 1_000_000,
    });
    const report = await lintBytes(
      pptxWithTemplateShapes(slideWith(inherited, local), layout),
      "layout-placeholder-overlap.pptx",
    );

    expect(
      report.findings.find(
        (finding) => finding.ruleId === "layout/text-overlap",
      ),
    ).toMatchObject({
      location: { shapeIds: [8, 9] },
      evidence: { overlapRatio: 1 },
    });
  });

  it("ignores hidden text frames", async () => {
    const report = await lint(
      slideWith(
        textShape({
          id: 2,
          name: "Visible",
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
        textShape({
          id: 3,
          name: "Hidden",
          hidden: true,
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
      ),
      "hidden-overlap.pptx",
    );

    expect(report.findings).toEqual([]);
  });

  it.each([
    ["below", 810_000, 0],
    ["at", 800_000, 1],
    ["above", 790_000, 1],
  ] as const)(
    "handles the %s threshold boundary",
    async (_caseName, secondX, expectedCount) => {
      const report = await lint(
        slideWith(
          textShape({
            id: 2,
            name: "A",
            x: 0,
            y: 0,
            width: 1_000_000,
            height: 1_000_000,
          }),
          textShape({
            id: 9,
            name: "B",
            x: secondX,
            y: 0,
            width: 1_000_000,
            height: 1_000_000,
          }),
        ),
        `${_caseName}.pptx`,
      );

      expect(
        report.findings.filter(
          (finding) => finding.ruleId === "layout/text-overlap",
        ),
      ).toHaveLength(expectedCount);
    },
  );

  it("emits one canonical A/B finding with frame-geometry evidence", async () => {
    const report = await lint(
      slideWith(
        textShape({
          id: 22,
          name: "Front",
          x: 500_000,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
        textShape({
          id: 18,
          name: "Back",
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
      ),
      "canonical.pptx",
    );
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "layout/text-overlap",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      location: { shapeIds: [18, 22] },
      evidence: {
        firstShapeId: 18,
        secondShapeId: 22,
        intersectionAreaEmu2: 500_000_000_000,
        overlapRatio: 0.5,
        minOverlapRatio: 0.2,
      },
    });
    expect(findings[0]?.message).toContain("frame geometry");
    expect(findings[0]?.message).not.toContain("glyphs overlap");
  });

  it("excludes empty text and does not compare cells inside one table", async () => {
    const table = tableShape({
      id: 4,
      name: "Table",
      x: 0,
      y: 0,
      width: 1_000_000,
      height: 1_000_000,
    });
    const report = await lint(
      slideWith(
        textShape({
          id: 3,
          name: "Whitespace",
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
          text: "   ",
        }),
        table,
      ),
      "same-object.pptx",
    );

    expect(
      report.findings.filter(
        (finding) => finding.ruleId === "layout/text-overlap",
      ),
    ).toEqual([]);

    const externalOverlap = await lint(
      slideWith(
        table,
        textShape({
          id: 5,
          name: "External",
          x: 0,
          y: 0,
          width: 250_000,
          height: 500_000,
        }),
      ),
      "table-external.pptx",
    );
    const overlapFindings = externalOverlap.findings.filter(
      (finding) => finding.ruleId === "layout/text-overlap",
    );
    expect(overlapFindings).toHaveLength(1);
    expect(overlapFindings[0]).toMatchObject({
      location: { shapeIds: [4, 5] },
      evidence: { firstTextFrame: "table:r0:c0", overlapRatio: 1 },
    });
  });

  it("keeps the cell after an Office-style gridSpan/hMerge region", async () => {
    const report = await lint(
      slideWith(
        mergedTableShape({
          id: 4,
          name: "Merged table",
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
        textShape({
          id: 5,
          name: "Third-column overlap",
          x: 600_000,
          y: 0,
          width: 400_000,
          height: 1_000_000,
        }),
      ),
      "merged-table.pptx",
    );
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "layout/text-overlap",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      location: { shapeIds: [4, 5] },
      evidence: { firstTextFrame: "table:r0:c2", overlapRatio: 1 },
    });
  });

  it("keeps canonical fingerprints stable across XML/z-order reversal", async () => {
    const a = textShape({
      id: 2,
      name: "A",
      x: 0,
      y: 0,
      width: 1_000_000,
      height: 1_000_000,
    });
    const b = textShape({
      id: 9,
      name: "B",
      x: 500_000,
      y: 0,
      width: 1_000_000,
      height: 1_000_000,
    });
    const first = await lint(slideWith(a, b), "stable.pptx");
    const second = await lint(slideWith(b, a), "stable.pptx");

    expect(first.findings[0]?.fingerprint).toBe(
      second.findings[0]?.fingerprint,
    );
  });
});

describe("layout rule configuration", () => {
  it("supports severity and threshold overrides", async () => {
    const bytes = buildMinimalPptx({
      slideXml: slideWith(
        textShape({
          id: 2,
          name: "A",
          x: 0,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
        textShape({
          id: 3,
          name: "B",
          x: 500_000,
          y: 0,
          width: 1_000_000,
          height: 1_000_000,
        }),
      ),
    });
    const report = await lintPptx(
      { bytes, displayPath: "override.pptx", inputKey: "override.pptx" },
      {
        config: resolveConfig({
          extends: ["recommended"],
          rules: {
            "layout/text-overlap": ["warning", { minOverlapRatio: 0.6 }],
          },
        }),
      },
    );

    expect(report.findings).toEqual([]);
    expect(
      resolveConfig({
        rules: {
          "layout/outside-slide": [
            "warning",
            { tolerancePt: 4, minOutsideRatio: 0.1 },
          ],
        },
      }).rules.get("layout/outside-slide"),
    ).toMatchObject({
      enabled: true,
      severity: "warning",
      options: { tolerancePt: 4, minOutsideRatio: 0.1 },
    });
  });

  it.each([
    [
      { "layout/outside-slide": ["warning", { tolerancePt: -1 }] },
      "tolerancePt",
    ],
    [
      { "layout/text-overlap": ["error", { minOverlapRatio: 1.1 }] },
      "minOverlapRatio",
    ],
    [
      { "layout/text-overlap": ["error", { minOverlapRatio: null }] },
      "minOverlapRatio",
    ],
    [{ "layout/text-overlap": ["error", { guessed: true }] }, "unknown option"],
  ])("rejects invalid geometry options %#", (rules, message) => {
    expect(() => resolveConfig({ rules })).toThrow(ConfigError);
    expect(() => resolveConfig({ rules })).toThrow(message);
  });
});

async function lint(slideXml: string, file: string) {
  return lintBytes(buildMinimalPptx({ slideXml }), file);
}

async function lintBytes(bytes: Uint8Array, file: string) {
  return lintPptx(
    { bytes, displayPath: file, inputKey: file },
    { config: resolveConfig() },
  );
}

function slideWith(...shapes: readonly string[]): string {
  return minimalSlideXml().replace(
    "</p:spTree>",
    `${shapes.join("\n")}</p:spTree>`,
  );
}

function pptxWithTemplateShapes(
  slideXml: string,
  layoutShapes: string,
  masterShapes = "",
): Uint8Array {
  return buildRawZip(
    minimalPptxEntries(slideXml).map((entry) => {
      if (typeof entry.data !== "string") return entry;
      if (entry.name === "ppt/slideLayouts/slideLayout1.xml") {
        return {
          ...entry,
          data: entry.data.replace("</p:spTree>", `${layoutShapes}</p:spTree>`),
        };
      }
      if (entry.name === "ppt/slideMasters/slideMaster1.xml") {
        return {
          ...entry,
          data: entry.data.replace("</p:spTree>", `${masterShapes}</p:spTree>`),
        };
      }
      return entry;
    }),
  );
}

interface ShapeFixture {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly text?: string;
  readonly hidden?: boolean;
}

function textShape(shape: ShapeFixture): string {
  const rotation =
    shape.rotation === undefined
      ? ""
      : ` rot="${String(shape.rotation * 60_000)}"`;
  const hidden = shape.hidden === true ? ' hidden="1"' : "";
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"${hidden}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm${rotation}><a:off x="${String(shape.x)}" y="${String(shape.y)}"/><a:ext cx="${String(shape.width)}" cy="${String(shape.height)}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${shape.text ?? shape.name}</a:t></a:r></a:p></p:txBody>
  </p:sp>`;
}

function pictureShape(shape: ShapeFixture): string {
  const hidden = shape.hidden === true ? ' hidden="1"' : "";
  return `<p:pic>
    <p:nvPicPr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"${hidden}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill/><p:spPr><a:xfrm><a:off x="${String(shape.x)}" y="${String(shape.y)}"/><a:ext cx="${String(shape.width)}" cy="${String(shape.height)}"/></a:xfrm></p:spPr>
  </p:pic>`;
}

function tableShape(shape: ShapeFixture): string {
  return `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="${String(shape.x)}" y="${String(shape.y)}"/><a:ext cx="${String(shape.width)}" cy="${String(shape.height)}"/></p:xfrm>
    <a:graphic><a:graphicData><a:tbl>
      <a:tblGrid><a:gridCol w="500000"/><a:gridCol w="500000"/></a:tblGrid>
      <a:tr h="1000000"><a:tc><a:txBody><a:p><a:r><a:t>Left</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Right</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic>
  </p:graphicFrame>`;
}

interface PlaceholderFixture {
  readonly id: number;
  readonly name: string;
  readonly index: number;
  readonly type: string;
  readonly text: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

function placeholderShape(shape: PlaceholderFixture): string {
  const hasTransform =
    shape.x !== undefined &&
    shape.y !== undefined &&
    shape.width !== undefined &&
    shape.height !== undefined;
  const transform = hasTransform
    ? `<a:xfrm><a:off x="${String(shape.x)}" y="${String(shape.y)}"/><a:ext cx="${String(shape.width)}" cy="${String(shape.height)}"/></a:xfrm>`
    : "";
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"/><p:cNvSpPr/><p:nvPr><p:ph idx="${String(shape.index)}" type="${shape.type}"/></p:nvPr></p:nvSpPr>
    <p:spPr>${transform}</p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${shape.text}</a:t></a:r></a:p></p:txBody>
  </p:sp>`;
}

function mergedTableShape(shape: ShapeFixture): string {
  return `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="${String(shape.x)}" y="${String(shape.y)}"/><a:ext cx="${String(shape.width)}" cy="${String(shape.height)}"/></p:xfrm>
    <a:graphic><a:graphicData><a:tbl>
      <a:tblGrid><a:gridCol w="300000"/><a:gridCol w="300000"/><a:gridCol w="400000"/></a:tblGrid>
      <a:tr h="1000000">
        <a:tc gridSpan="2"><a:txBody><a:p><a:r><a:t>Merged</a:t></a:r></a:p></a:txBody></a:tc>
        <a:tc hMerge="1"><a:txBody><a:p/></a:txBody></a:tc>
        <a:tc><a:txBody><a:p><a:r><a:t>Third</a:t></a:r></a:p></a:txBody></a:tc>
      </a:tr>
    </a:tbl></a:graphicData></a:graphic>
  </p:graphicFrame>`;
}
