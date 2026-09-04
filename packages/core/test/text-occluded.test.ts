import { describe, expect, it } from "vitest";

import {
  buildRawZip,
  minimalPptxEntries,
  minimalSlideXml,
  OFFICE_RELATIONSHIPS_NAMESPACE,
} from "../../../fixtures/builders/index.js";
import {
  ConfigError,
  inspectRasterOpacity,
  lintPptx,
  resolveConfig,
} from "../src/index.js";

describe("layout/text-occluded", () => {
  it("reports an opaque solid shape only when it is above the text", async () => {
    const covered = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        solidShape({ id: 3, name: "Cover" }),
      ),
      "covered.pptx",
    );
    const finding = covered.findings.find(
      (candidate) => candidate.ruleId === "layout/text-occluded",
    );

    expect(finding).toMatchObject({
      severity: "error",
      location: {
        part: "ppt/slides/slide1.xml",
        slideNumber: 1,
        slideId: "256",
        shapeIds: [2, 3],
      },
      evidence: {
        foregroundShapeId: 3,
        foregroundZIndex: 1,
        minOccludedRatio: 0.2,
        occludedRatio: 1,
        opacityAlpha: 1,
        opacityBasis: "solid-fill",
        opacityState: "opaque",
        textFrame: "shape",
        textShapeId: 2,
        textZIndex: 0,
      },
    });
    expect(finding?.message).toContain("text-frame geometry");
    expect(finding?.message).toContain("not pixel-perfect");

    const textAbove = await lint(
      slideWith(
        solidShape({ id: 3, name: "Behind" }),
        textShape({ id: 2, name: "Text" }),
      ),
      "text-above.pptx",
    );
    expect(ruleFindings(textAbove)).toEqual([]);
  });

  it("does not treat no-fill, partial alpha, or unresolved fills as opaque", async () => {
    const foregrounds = [
      shapeWithFill({ id: 3, name: "No fill" }, "<a:noFill/>"),
      shapeWithFill(
        { id: 4, name: "Partial alpha" },
        '<a:solidFill><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>',
      ),
      shapeWithFill(
        { id: 5, name: "Gradient" },
        '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs></a:gsLst></a:gradFill>',
      ),
      shapeWithFill({ id: 6, name: "Inherited fill" }, ""),
      shapeWithFill(
        { id: 7, name: "Ellipse" },
        '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
        "ellipse",
      ),
    ];

    for (const [index, foreground] of foregrounds.entries()) {
      const report = await lint(
        slideWith(textShape({ id: 2, name: "Text" }), foreground),
        `non-opaque-${String(index)}.pptx`,
      );
      expect(ruleFindings(report)).toEqual([]);
    }
  });

  it("requires rectangular preset geometry for picture occluders", async () => {
    const cases = [
      pptxWithImage(jpegBytes(), "ellipse.jpg", {
        geometryXml: '<a:prstGeom prst="ellipse"/>',
      }),
      pptxWithImage(jpegBytes(), "custom.jpg", {
        geometryXml: "<a:custGeom/>",
      }),
    ];

    for (const [index, bytes] of cases.entries()) {
      const report = await lintBytes(
        bytes,
        `non-rect-picture-${String(index)}.pptx`,
      );
      expect(ruleFindings(report)).toEqual([]);
    }
  });

  it("keeps alpha-sensitive shape-property effects conservative", async () => {
    const softEdge = '<a:effectLst><a:softEdge rad="12700"/></a:effectLst>';
    const shapeReport = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        shapeWithFill(
          { id: 3, name: "Soft shape" },
          '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
          "rect",
          softEdge,
        ),
      ),
      "soft-shape.pptx",
    );
    const pictureReport = await lintBytes(
      pptxWithImage(jpegBytes(), "soft-picture.jpg", {
        shapeEffects: softEdge,
      }),
      "soft-picture.pptx",
    );
    const effectDagReport = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        shapeWithFill(
          { id: 3, name: "Effect DAG" },
          '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
          "rect",
          "<a:effectDag/>",
        ),
      ),
      "effect-dag.pptx",
    );

    expect(ruleFindings(shapeReport)).toEqual([]);
    expect(ruleFindings(pictureReport)).toEqual([]);
    expect(ruleFindings(effectDagReport)).toEqual([]);
  });

  it("requires a local absolute alpha before treating scheme colors as opaque", async () => {
    const unresolved = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        shapeWithFill(
          { id: 3, name: "Theme fill" },
          '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>',
        ),
      ),
      "theme-alpha-unresolved.pptx",
    );
    const relativeAlpha = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        shapeWithFill(
          { id: 3, name: "Theme fill relative alpha" },
          '<a:solidFill><a:schemeClr val="accent1"><a:alphaMod val="100000"/></a:schemeClr></a:solidFill>',
        ),
      ),
      "theme-relative-alpha.pptx",
    );
    const locallyOpaque = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        shapeWithFill(
          { id: 3, name: "Theme fill override" },
          '<a:solidFill><a:schemeClr val="accent1"><a:alpha val="100000"/></a:schemeClr></a:solidFill>',
        ),
      ),
      "theme-alpha-override.pptx",
    );

    expect(ruleFindings(unresolved)).toEqual([]);
    expect(ruleFindings(relativeAlpha)).toEqual([]);
    expect(ruleFindings(locallyOpaque)).toHaveLength(1);
    expect(ruleFindings(locallyOpaque)[0]).toMatchObject({
      evidence: { opacityAlpha: 1, opacityBasis: "solid-fill" },
    });
  });

  it("uses the configured text-frame coverage threshold", async () => {
    const bytes = pptx(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        solidShape({
          id: 3,
          name: "Quarter cover",
          x: 750_000,
        }),
      ),
    );
    const defaultReport = await lintBytes(bytes, "default-threshold.pptx");
    const stricterReport = await lintPptx(
      {
        bytes,
        displayPath: "strict-threshold.pptx",
        inputKey: "strict-threshold.pptx",
      },
      {
        config: resolveConfig({
          extends: ["recommended"],
          rules: {
            "layout/text-occluded": ["error", { minOccludedRatio: 0.3 }],
          },
        }),
      },
    );

    expect(ruleFindings(defaultReport)[0]).toMatchObject({
      evidence: { occludedRatio: 0.25 },
    });
    expect(ruleFindings(stricterReport)).toEqual([]);
  });

  it.each([
    ["JPEG", "cover.jpg", jpegBytes(), "jpeg"],
    ["PNG without alpha", "cover.png", pngBytes(2), "png-without-alpha"],
  ] as const)(
    "classifies an embedded %s as a high-confidence opaque occluder",
    async (_label, mediaName, bytes, opacityBasis) => {
      const report = await lintBytes(
        pptxWithImage(bytes, mediaName),
        `opaque-${mediaName}.pptx`,
      );

      expect(ruleFindings(report)).toHaveLength(1);
      expect(ruleFindings(report)[0]).toMatchObject({
        evidence: {
          foregroundShapeId: 3,
          imageRelationshipId: "rId2",
          mediaPart: `ppt/media/${mediaName}`,
          opacityBasis,
          opacityState: "opaque",
        },
      });
    },
  );

  it("keeps PNG alpha, unknown formats, and DrawingML image alpha conservative", async () => {
    const cases = [
      pptxWithImage(pngBytes(6), "alpha.png"),
      pptxWithImage(new Uint8Array([1, 2, 3, 4]), "unknown.bin"),
      pptxWithImage(jpegBytes(), "faded.jpg", {
        blipEffects: '<a:alphaModFix amt="50000"/>',
      }),
    ];

    for (const [index, bytes] of cases.entries()) {
      const report = await lintBytes(
        bytes,
        `image-alpha-${String(index)}.pptx`,
      );
      expect(ruleFindings(report)).toEqual([]);
    }
  });

  it("uses transformed polygons for rotated and grouped foreground shapes", async () => {
    const rotated = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        solidShape({ id: 3, name: "Rotated", rotation: 45 }),
      ),
      "rotated-cover.pptx",
    );
    const grouped = await lint(
      slideWith(
        textShape({ id: 2, name: "Text" }),
        groupShape(
          solidShape({
            id: 4,
            name: "Grouped",
            width: 100,
            height: 100,
          }),
        ),
      ),
      "grouped-cover.pptx",
    );

    const rotatedFinding = ruleFindings(rotated)[0];
    expect(rotatedFinding).toMatchObject({
      evidence: { foregroundShapeId: 3 },
    });
    expect(rotatedFinding?.evidence.occludedRatio).toBeCloseTo(0.828427, 6);
    expect(ruleFindings(grouped)[0]).toMatchObject({
      evidence: { foregroundShapeId: 4, occludedRatio: 1 },
    });
  });

  it.each([
    [-0.1, "minOccludedRatio"],
    [1.1, "minOccludedRatio"],
    [null, "minOccludedRatio"],
  ])("rejects invalid coverage option %#", (minOccludedRatio, message) => {
    const value = {
      rules: {
        "layout/text-occluded": ["error", { minOccludedRatio }],
      },
    };
    expect(() => resolveConfig(value)).toThrow(ConfigError);
    expect(() => resolveConfig(value)).toThrow(message);
  });
});

describe("raster opacity inspection", () => {
  it("recognizes alpha channels and palette transparency without decoding pixels", () => {
    expect(inspectRasterOpacity(jpegBytes())).toEqual({
      state: "opaque",
      basis: "jpeg",
    });
    expect(inspectRasterOpacity(pngBytes(2))).toEqual({
      state: "opaque",
      basis: "png-without-alpha",
    });
    expect(inspectRasterOpacity(pngBytes(6))).toEqual({
      state: "unknown",
      basis: "png-alpha-channel",
    });
    expect(inspectRasterOpacity(pngBytes(3, true))).toEqual({
      state: "unknown",
      basis: "png-alpha-channel",
    });
    expect(inspectRasterOpacity(pngBytes(2).slice(0, 30))).toEqual({
      state: "unknown",
      basis: "unsupported-image-format",
    });
  });
});

interface ShapeFixture {
  readonly id: number;
  readonly name: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
}

function textShape(shape: ShapeFixture): string {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${transform(shape)}<a:prstGeom prst="rect"/></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${shape.name}</a:t></a:r></a:p></p:txBody>
  </p:sp>`;
}

function solidShape(shape: ShapeFixture): string {
  return shapeWithFill(
    shape,
    '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
  );
}

function shapeWithFill(
  shape: ShapeFixture,
  fill: string,
  geometry = "rect",
  effects = "",
): string {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${String(shape.id)}" name="${shape.name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${transform(shape)}<a:prstGeom prst="${geometry}"/>${fill}${effects}</p:spPr>
  </p:sp>`;
}

interface PictureFixtureOptions {
  readonly blipEffects?: string;
  readonly geometryXml?: string;
  readonly shapeEffects?: string;
}

function pictureShape(options: PictureFixtureOptions = {}): string {
  return `<p:pic>
    <p:nvPicPr><p:cNvPr id="3" name="Image cover"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rId2">${options.blipEffects ?? ""}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>
    <p:spPr>${transform({ id: 3, name: "Image cover" })}${options.geometryXml ?? '<a:prstGeom prst="rect"/>'}${options.shapeEffects ?? ""}</p:spPr>
  </p:pic>`;
}

function groupShape(child: string): string {
  return `<p:grpSp>
    <p:nvGrpSpPr><p:cNvPr id="10" name="Cover group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>
    ${child}
  </p:grpSp>`;
}

function transform(shape: ShapeFixture): string {
  const rotation =
    shape.rotation === undefined
      ? ""
      : ` rot="${String(shape.rotation * 60_000)}"`;
  return `<a:xfrm${rotation}><a:off x="${String(shape.x ?? 0)}" y="${String(shape.y ?? 0)}"/><a:ext cx="${String(shape.width ?? 1_000_000)}" cy="${String(shape.height ?? 1_000_000)}"/></a:xfrm>`;
}

function slideWith(...shapes: readonly string[]): string {
  return minimalSlideXml().replace(
    "</p:spTree>",
    `${shapes.join("\n")}</p:spTree>`,
  );
}

function pptx(slideXml: string): Uint8Array {
  return buildRawZip(minimalPptxEntries(slideXml));
}

function pptxWithImage(
  bytes: Uint8Array,
  mediaName: string,
  options: PictureFixtureOptions = {},
): Uint8Array {
  const slideXml = slideWith(
    textShape({ id: 2, name: "Text" }),
    pictureShape(options),
  );
  const entries = minimalPptxEntries(slideXml).map((entry) =>
    entry.name === "ppt/slides/_rels/slide1.xml.rels"
      ? {
          ...entry,
          data: `<?xml version="1.0"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
              <Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/${mediaName}"/>
            </Relationships>`,
        }
      : entry,
  );
  return buildRawZip([
    ...entries,
    { name: `ppt/media/${mediaName}`, data: bytes },
  ]);
}

async function lint(slideXml: string, file: string) {
  return lintBytes(pptx(slideXml), file);
}

async function lintBytes(bytes: Uint8Array, file: string) {
  return lintPptx(
    { bytes, displayPath: file, inputKey: file },
    {
      config: resolveConfig({
        rules: { "layout/text-occluded": "error" },
      }),
    },
  );
}

function ruleFindings(report: Awaited<ReturnType<typeof lintPptx>>) {
  return report.findings.filter(
    (finding) => finding.ruleId === "layout/text-occluded",
  );
}

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
}

function pngBytes(colorType: number, transparency = false): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  header[8] = 8;
  header[9] = colorType;
  return concatenate([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    ...(transparency ? [pngChunk("tRNS", new Uint8Array([0]))] : []),
    pngChunk("IDAT", new Uint8Array()),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length);
  for (let index = 0; index < type.length; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  return chunk;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
