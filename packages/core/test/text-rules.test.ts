import { describe, expect, it } from "vitest";

import {
  buildMinimalPptx,
  buildRawZip,
  DRAWINGML_NAMESPACE,
  minimalPptxEntries,
  minimalSlideXml,
  OFFICE_RELATIONSHIPS_NAMESPACE,
} from "../../../fixtures/builders/index.js";
import type { RawZipEntry } from "../../../fixtures/builders/index.js";
import {
  buildPptxContext,
  ConfigError,
  lintPptx,
  resolveConfig,
} from "../src/index.js";

describe("effective text style resolution", () => {
  it("resolves run, paragraph, list, and master title sizes with provenance", async () => {
    const bytes = pptxWithReplacements(
      slideWith(
        textShape({
          id: 2,
          name: "Explicit",
          runProperties: '<a:rPr sz="1100"/>',
        }),
        textShape({
          id: 3,
          name: "Paragraph inherited",
          paragraphProperties: '<a:pPr><a:defRPr sz="1300"/></a:pPr>',
        }),
        textShape({
          id: 4,
          name: "List inherited",
          listStyle: '<a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr>',
        }),
        textShape({
          id: 5,
          name: "Title inherited",
          placeholder: '<p:ph type="title" idx="5"/>',
        }),
      ),
      {
        "ppt/slideMasters/slideMaster1.xml": (xml) =>
          xml.replace(
            "<p:titleStyle/>",
            '<p:titleStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:titleStyle>',
          ),
      },
    );
    const built = await buildPptxContext(bytes, { inputKey: "styles.pptx" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    try {
      const byShape = new Map(
        built.context.text.bodies.map((body) => [body.shapeId, body]),
      );
      expect(byShape.get(2)?.runs[0]?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 11,
        sourcePart: "ppt/slides/slide1.xml",
        sourceKind: "run-properties",
      });
      expect(byShape.get(3)?.runs[0]?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 13,
        sourceKind: "paragraph-default",
      });
      expect(byShape.get(4)?.runs[0]?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 14,
        sourceKind: "shape-list-style",
      });
      expect(byShape.get(5)).toMatchObject({ placeholderKind: "title" });
      expect(byShape.get(5)?.runs[0]?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 18,
        sourcePart: "ppt/slideMasters/slideMaster1.xml",
        sourceKind: "master-title-text-style",
      });
    } finally {
      await built.context.close();
    }
  });

  it("leaves unsupported style chains unresolved instead of guessing defaults", async () => {
    const bytes = buildMinimalPptx({
      slideXml: slideWith(textShape({ id: 2, name: "No size" })),
    });
    const built = await buildPptxContext(bytes, {
      inputKey: "unresolved-size.pptx",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    try {
      const size = built.context.text.bodies[0]?.runs[0]?.style.baseFontSizePt;
      expect(size?.status).toBe("unresolved");
      if (size?.status === "unresolved") {
        expect(size.reason).toContain("No font size");
      }
    } finally {
      await built.context.close();
    }
  });

  it("walks matching layout and master placeholder text bodies", async () => {
    const slideXml = slideWith(
      textShape({
        id: 5,
        name: "Layout inherited",
        placeholder: '<p:ph type="body" idx="5"/>',
      }),
      textShape({
        id: 6,
        name: "Master inherited",
        placeholder: '<p:ph type="title" idx="6"/>',
      }),
    );
    const layoutPlaceholders = [
      textShape({
        id: 50,
        name: "Layout body",
        placeholder: '<p:ph type="body" idx="5"/>',
        listStyle: '<a:lvl1pPr><a:defRPr sz="1500"/></a:lvl1pPr>',
      }),
      textShape({
        id: 60,
        name: "Layout title",
        placeholder: '<p:ph type="title" idx="6"/>',
      }),
    ].join("");
    const masterPlaceholder = textShape({
      id: 70,
      name: "Master title",
      placeholder: '<p:ph type="title" idx="6"/>',
      listStyle: '<a:lvl1pPr><a:defRPr sz="2100"/></a:lvl1pPr>',
    });
    const bytes = pptxWithReplacements(slideXml, {
      "ppt/slideLayouts/slideLayout1.xml": (xml) =>
        xml.replace("</p:spTree>", `${layoutPlaceholders}</p:spTree>`),
      "ppt/slideMasters/slideMaster1.xml": (xml) =>
        xml.replace("</p:spTree>", `${masterPlaceholder}</p:spTree>`),
    });
    const built = await buildPptxContext(bytes, {
      inputKey: "placeholder-styles.pptx",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    try {
      const byShape = new Map(
        built.context.text.bodies.map((body) => [body.shapeId, body]),
      );
      expect(byShape.get(5)?.runs[0]?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 15,
        sourcePart: "ppt/slideLayouts/slideLayout1.xml",
        sourceKind: "layout-placeholder-style",
      });
      expect(byShape.get(6)?.runs[0]?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 21,
        sourcePart: "ppt/slideMasters/slideMaster1.xml",
        sourceKind: "master-placeholder-style",
      });
    } finally {
      await built.context.close();
    }
  });
});

describe("text/min-font-size", () => {
  it("reports explicit and inherited sizes against body and title thresholds", async () => {
    const bytes = pptxWithReplacements(
      slideWith(
        textShape({
          id: 2,
          name: "Small body",
          runProperties: '<a:rPr sz="1100"/>',
        }),
        textShape({
          id: 3,
          name: "Small title",
          placeholder: '<p:ph type="title"/>',
        }),
      ),
      {
        "ppt/slideMasters/slideMaster1.xml": (xml) =>
          xml.replace(
            "<p:titleStyle/>",
            '<p:titleStyle><a:lvl1pPr><a:defRPr sz="1900"/></a:lvl1pPr></p:titleStyle>',
          ),
      },
    );
    const report = await lint(bytes, "minimums.pptx");
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "text/min-font-size",
    );

    expect(findings).toHaveLength(2);
    const bodyFinding = findings.find(
      (finding) => finding.location.shapeIds?.[0] === 2,
    );
    const titleFinding = findings.find(
      (finding) => finding.location.shapeIds?.[0] === 3,
    );
    expect(bodyFinding?.evidence.baseFontSizePt).toBe(11);
    expect(bodyFinding?.evidence.configuredMinimumPt).toBe(12);
    expect(bodyFinding?.evidence.placeholderKind).toBe("other");
    expect(bodyFinding?.evidence.sizeProvenance).toMatchObject({
      sourceKind: "run-properties",
    });
    expect(titleFinding?.evidence.baseFontSizePt).toBe(19);
    expect(titleFinding?.evidence.configuredMinimumPt).toBe(20);
    expect(titleFinding?.evidence.placeholderKind).toBe("title");
  });

  it("honors configured threshold boundaries and severity", async () => {
    const bytes = buildMinimalPptx({
      slideXml: slideWith(
        textShape({
          id: 2,
          name: "At boundary",
          runProperties: '<a:rPr sz="1050"/>',
        }),
      ),
    });
    const report = await lint(bytes, "boundary.pptx", {
      rules: {
        "text/min-font-size": ["warning", { defaultPt: 10.5, titlePt: 20 }],
      },
    });

    expect(report.findings).toEqual([]);
  });
});

describe("autofit rules", () => {
  it("normalizes persisted fontScale and gives the specialized rule ownership", async () => {
    const belowReports = await Promise.all(
      ["40000", "40.000%"].map((fontScale) =>
        lint(
          buildMinimalPptx({
            slideXml: slideWith(
              textShape({
                id: 2,
                name: "Scaled",
                autofit: `<a:normAutofit fontScale="${fontScale}"/>`,
                runProperties: '<a:rPr sz="2400"/>',
              }),
            ),
          }),
          `scaled-${fontScale.replaceAll(".", "-").replace("%", "pct")}.pptx`,
        ),
      ),
    );
    const atBoundary = await lint(
      buildMinimalPptx({
        slideXml: slideWith(
          textShape({
            id: 2,
            name: "Scaled boundary",
            autofit: '<a:normAutofit fontScale="50000"/>',
            runProperties: '<a:rPr sz="2400"/>',
          }),
        ),
      }),
      "scaled-boundary.pptx",
    );

    for (const [index, below] of belowReports.entries()) {
      expect(below.findings).toHaveLength(1);
      expect(below.findings[0]?.ruleId).toBe(
        "text/autofit-scale-below-minimum",
      );
      expect(below.findings[0]?.evidence.baseFontSizePt).toBe(24);
      expect(below.findings[0]?.evidence.effectiveFontSizePt).toBe(9.6);
      expect(below.findings[0]?.evidence.fontScaleRatio).toBe(0.4);
      expect(below.findings[0]?.evidence.rawFontScale).toBe(
        index === 0 ? "40000" : "40.000%",
      );
    }
    expect(atBoundary.findings).toEqual([]);
  });

  it("warns once for runtime autofit without a usable persisted scale", async () => {
    for (const autofit of [
      "<a:normAutofit/>",
      '<a:normAutofit fontScale="invalid"/>',
    ]) {
      const report = await lint(
        buildMinimalPptx({
          slideXml: slideWith(
            textShape({
              id: 2,
              name: "Runtime",
              autofit,
              runProperties: '<a:rPr sz="2400"/>',
            }),
          ),
        }),
        "runtime-autofit.pptx",
      );

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.ruleId).toBe("text/autofit-enabled");
      expect(report.findings[0]?.severity).toBe("warning");
      expect(report.findings[0]?.location.shapeIds).toEqual([2]);
      expect(report.findings[0]?.evidence.autofitKind).toBe("runtime");
    }
  });

  it("does not expose a guessed effective size for runtime autofit", async () => {
    const built = await buildPptxContext(
      buildMinimalPptx({
        slideXml: slideWith(
          textShape({
            id: 2,
            name: "Unknown effective size",
            autofit: "<a:normAutofit/>",
            runProperties: '<a:rPr sz="2400"/>',
          }),
        ),
      }),
      { inputKey: "unknown-effective-size.pptx" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    try {
      const run = built.context.text.bodies[0]?.runs[0];
      expect(run?.style.baseFontSizePt).toMatchObject({
        status: "resolved",
        value: 24,
      });
      expect(run?.style.fontSizePt.status).toBe("unresolved");
    } finally {
      await built.context.close();
    }
  });

  it("does not treat shape-to-fit-text as shrinking runtime autofit", async () => {
    const report = await lint(
      buildMinimalPptx({
        slideXml: slideWith(
          textShape({
            id: 2,
            name: "Growing shape",
            autofit: "<a:spAutoFit/>",
            runProperties: '<a:rPr sz="2400"/>',
          }),
        ),
      }),
      "shape-autofit.pptx",
    );

    expect(report.findings).toEqual([]);
  });
});

describe("fonts/allowed", () => {
  it("resolves theme placeholders per used script slot for mixed text", async () => {
    const bytes = pptxWithReplacements(
      slideWith(
        textShape({
          id: 2,
          name: "Mixed scripts",
          runProperties:
            '<a:rPr><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="Forbidden Arabic"/></a:rPr>',
          text: "Hello テスト العربية",
        }),
      ),
      {
        "ppt/theme/theme1.xml": (xml) =>
          xml.replace(
            '<a:ea typeface=""/><a:cs typeface=""/>',
            '<a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="Yu Gothic"/>',
          ),
      },
    );
    const report = await lint(bytes, "mixed-fonts.pptx", {
      rules: {
        "fonts/allowed": [
          "error",
          {
            families: ["Arial", "Yu Gothic"],
            unresolved: "error",
          },
        ],
      },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.ruleId).toBe("fonts/allowed");
    expect(report.findings[0]?.location).toMatchObject({
      slideNumber: 1,
      slideId: "256",
      shapeIds: [2],
      paragraphIndex: 0,
      runIndex: 0,
    });
    expect(report.findings[0]?.evidence.resolvedTypeface).toBe(
      "Forbidden Arabic",
    );
    expect(report.findings[0]?.evidence.scriptSlot).toBe("complexScript");
  });

  it.each([
    ["Arab", "العربية"],
    ["Hebr", "עברית"],
    ["Syrc", "ܣܘܪܝܝܐ"],
    ["Thaa", "ދިވެހި"],
    ["Deva", "हिन्दी"],
    ["Beng", "বাংলা"],
    ["Guru", "ਪੰਜਾਬੀ"],
    ["Gujr", "ગુજરાતી"],
    ["Orya", "ଓଡ଼ିଆ"],
    ["Taml", "தமிழ்"],
    ["Telu", "తెలుగు"],
    ["Knda", "ಕನ್ನಡ"],
    ["Mlym", "മലയാളം"],
    ["Sinh", "සිංහල"],
    ["Thai", "ไทย"],
    ["Laoo", "ລາວ"],
    ["Tibt", "བོད"],
    ["Mymr", "မြန်မာ"],
    ["Khmr", "ខ្មែរ"],
  ] as const)(
    "resolves the %s supplemental Complex Script font",
    async (script, text) => {
      const bytes = pptxWithReplacements(
        slideWith(
          textShape({
            id: 2,
            name: `${script} text`,
            runProperties: '<a:rPr><a:cs typeface="+mj-cs"/></a:rPr>',
            text,
          }),
        ),
        {
          "ppt/theme/theme1.xml": (xml) =>
            xml.replace(
              '<a:cs typeface=""/>',
              `<a:cs typeface=""/><a:font script="${script}" typeface="Forbidden ${script}"/>`,
            ),
        },
      );
      const report = await lint(bytes, `${script}.pptx`, {
        rules: {
          "fonts/allowed": [
            "error",
            { families: ["Arial"], unresolved: "ignore" },
          ],
        },
      });

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.ruleId).toBe("fonts/allowed");
      expect(report.findings[0]?.evidence.resolvedTypeface).toBe(
        `Forbidden ${script}`,
      );
      expect(report.findings[0]?.evidence.scriptSlot).toBe("complexScript");
    },
  );

  it("keeps pure Han unresolved when only one language candidate exists", async () => {
    const bytes = pptxWithReplacements(
      slideWith(
        textShape({
          id: 2,
          name: "Han text",
          runProperties: '<a:rPr><a:ea typeface="+mj-ea"/></a:rPr>',
          text: "中文",
        }),
      ),
      {
        "ppt/theme/theme1.xml": (xml) =>
          xml.replace(
            '<a:ea typeface=""/>',
            '<a:ea typeface=""/><a:font script="Hans" typeface="Forbidden Han"/>',
          ),
      },
    );
    const report = await lint(bytes, "han-font.pptx", {
      rules: {
        "fonts/allowed": [
          "error",
          { families: ["Arial"], unresolved: "error" },
        ],
      },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.evidence.resolvedTypeface).toBeUndefined();
    expect(report.findings[0]?.evidence.scriptSlot).toBe("eastAsian");
    expect(report.findings[0]?.evidence.reason).toContain("does not resolve");
  });

  it("resolves pure Han when Hans and Hant use the same typeface", async () => {
    const bytes = pptxWithReplacements(
      slideWith(
        textShape({
          id: 2,
          name: "Han text",
          runProperties: '<a:rPr><a:ea typeface="+mj-ea"/></a:rPr>',
          text: "中文",
        }),
      ),
      {
        "ppt/theme/theme1.xml": (xml) =>
          xml.replace(
            '<a:ea typeface=""/>',
            '<a:ea typeface=""/><a:font script="Hans" typeface="Shared Han"/><a:font script="Hant" typeface="Shared Han"/>',
          ),
      },
    );
    const report = await lint(bytes, "shared-han-font.pptx", {
      rules: {
        "fonts/allowed": [
          "error",
          { families: ["Arial"], unresolved: "ignore" },
        ],
      },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.evidence.resolvedTypeface).toBe("Shared Han");
    expect(report.findings[0]?.evidence.scriptSlot).toBe("eastAsian");
  });

  it("uses run language to choose Hans versus Hant", async () => {
    const bytes = pptxWithReplacements(
      slideWith(
        textShape({
          id: 2,
          name: "Traditional Chinese",
          runProperties:
            '<a:rPr lang="zh-TW"><a:ea typeface="+mj-ea"/></a:rPr>',
          text: "中文",
        }),
      ),
      {
        "ppt/theme/theme1.xml": (xml) =>
          xml.replace(
            '<a:ea typeface=""/>',
            '<a:ea typeface=""/><a:font script="Hans" typeface="Allowed Hans"/><a:font script="Hant" typeface="Forbidden Hant"/>',
          ),
      },
    );
    const report = await lint(bytes, "hant-font.pptx", {
      rules: {
        "fonts/allowed": [
          "error",
          { families: ["Allowed Hans"], unresolved: "ignore" },
        ],
      },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.evidence.resolvedTypeface).toBe(
      "Forbidden Hant",
    );
  });

  it.each([
    "ppt/slides/_rels/slide1.xml.rels",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
  ] as const)(
    "keeps theme fonts unresolved when %s contains a theme override",
    async (relationshipsPart) => {
      const overridePart = "ppt/theme/themeOverride1.xml";
      const bytes = pptxWithReplacements(
        slideWith(
          textShape({
            id: 2,
            name: "Overridden theme font",
            runProperties: '<a:rPr><a:latin typeface="+mj-lt"/></a:rPr>',
          }),
        ),
        {
          "[Content_Types].xml": (xml) =>
            xml.replace(
              "</Types>",
              '<Override PartName="/ppt/theme/themeOverride1.xml" ContentType="application/vnd.openxmlformats-officedocument.themeOverride+xml"/></Types>',
            ),
          [relationshipsPart]: (xml) =>
            xml.replace(
              "</Relationships>",
              `<Relationship Id="rIdThemeOverride" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/themeOverride" Target="../theme/themeOverride1.xml"/></Relationships>`,
            ),
        },
        [{ name: overridePart, data: themeOverrideXml("Forbidden Override") }],
      );
      const report = await lint(bytes, "theme-override.pptx", {
        rules: {
          "fonts/allowed": [
            "error",
            { families: ["Arial"], unresolved: "error" },
          ],
        },
      });

      expect(report.analysisComplete).toBe(true);
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.ruleId).toBe("fonts/allowed");
      expect(report.findings[0]?.evidence.sourcePart).toBe(overridePart);
      expect(report.findings[0]?.evidence.sourceKind).toBe(
        "theme-override-unsupported",
      );
      expect(report.findings[0]?.evidence.reason).toContain("theme override");
    },
  );

  it("uses configured unresolved behavior without consulting system fonts", async () => {
    const bytes = buildMinimalPptx({
      slideXml: slideWith(textShape({ id: 2, name: "Unresolved font" })),
    });
    const report = await lint(bytes, "unresolved-font.pptx", {
      rules: {
        "fonts/allowed": [
          "error",
          { families: ["Arial"], unresolved: "warning" },
        ],
      },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.ruleId).toBe("fonts/allowed");
    expect(report.findings[0]?.severity).toBe("warning");
    expect(report.findings[0]?.evidence.scriptSlot).toBe("latin");
  });

  it("is disabled in recommended until an allowlist is configured", async () => {
    const report = await lint(
      buildMinimalPptx({
        slideXml: slideWith(
          textShape({
            id: 2,
            name: "Unconfigured policy",
            runProperties:
              '<a:rPr sz="2400"><a:latin typeface="Comic Sans MS"/></a:rPr>',
          }),
        ),
      }),
      "fonts-off.pptx",
    );

    expect(report.findings).toEqual([]);
  });
});

describe("typography rule configuration", () => {
  it("allows the font policy to be explicitly disabled without an allowlist", () => {
    expect(
      resolveConfig({ rules: { "fonts/allowed": "off" } }).rules.get(
        "fonts/allowed",
      ),
    ).toMatchObject({ enabled: false });
  });

  it.each([
    [
      {
        "text/min-font-size": ["error", { defaultPt: 0, titlePt: 20 }],
      },
      "defaultPt",
    ],
    [
      {
        "text/autofit-scale-below-minimum": [
          "error",
          { defaultPt: 12, titlePt: null },
        ],
      },
      "titlePt",
    ],
    [
      { "text/autofit-enabled": ["warning", { guessed: true }] },
      "unknown option",
    ],
    [{ "fonts/allowed": ["error", { families: [] }] }, "non-empty array"],
    [
      {
        "fonts/allowed": ["error", { families: ["Arial", "arial"] }],
      },
      "duplicate",
    ],
    [
      {
        "fonts/allowed": [
          "error",
          { families: ["Arial"], unresolved: "guess" },
        ],
      },
      "unresolved",
    ],
  ] as const)("rejects invalid typography options %#", (rules, message) => {
    expect(() => resolveConfig({ rules })).toThrow(ConfigError);
    expect(() => resolveConfig({ rules })).toThrow(message);
  });
});

async function lint(
  bytes: Uint8Array,
  file: string,
  config: unknown = { extends: ["recommended"] },
) {
  return lintPptx(
    { bytes, displayPath: file, inputKey: file },
    { config: resolveConfig(config) },
  );
}

interface TextShapeOptions {
  readonly id: number;
  readonly name: string;
  readonly text?: string;
  readonly placeholder?: string;
  readonly autofit?: string;
  readonly paragraphProperties?: string;
  readonly listStyle?: string;
  readonly runProperties?: string;
}

function textShape(options: TextShapeOptions): string {
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${String(options.id)}" name="${options.name}"/>
      <p:cNvSpPr/><p:nvPr>${options.placeholder ?? ""}</p:nvPr>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="100000" y="100000"/><a:ext cx="2000000" cy="500000"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </p:spPr>
    <p:txBody>
      <a:bodyPr>${options.autofit ?? ""}</a:bodyPr>
      <a:lstStyle>${options.listStyle ?? ""}</a:lstStyle>
      <a:p>${options.paragraphProperties ?? ""}<a:r>${options.runProperties ?? ""}<a:t>${options.text ?? options.name}</a:t></a:r></a:p>
    </p:txBody>
  </p:sp>`;
}

function slideWith(...shapes: readonly string[]): string {
  return minimalSlideXml().replace(
    "</p:spTree>",
    `${shapes.join("")}</p:spTree>`,
  );
}

function pptxWithReplacements(
  slideXml: string,
  replacements: Readonly<Record<string, (xml: string) => string>>,
  additionalEntries: readonly RawZipEntry[] = [],
): Uint8Array {
  return buildRawZip([
    ...minimalPptxEntries(slideXml).map((entry) => {
      const replacement = replacements[entry.name];
      if (replacement === undefined) return entry;
      if (typeof entry.data !== "string") {
        throw new TypeError("Expected a textual fixture entry.");
      }
      return { ...entry, data: replacement(entry.data) };
    }),
    ...additionalEntries,
  ]);
}

function themeOverrideXml(typeface: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <a:themeOverride xmlns:a="${DRAWINGML_NAMESPACE}">
      <a:fontScheme name="Override">
        <a:majorFont><a:latin typeface="${typeface}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
        <a:minorFont><a:latin typeface="${typeface}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
      </a:fontScheme>
    </a:themeOverride>`;
}
