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
  applySuppressions,
  BaselineError,
  createBaseline,
  determineExitCode,
  encodeInputKeyPath,
  lintPptx,
  normalizeInputKey,
  parseBaseline,
  resolveConfig,
  type PptxFinding,
} from "../src/index.js";

describe("exact suppressions", () => {
  it("canonicalizes a reversed shape pair and reports the matching reason", () => {
    const config = resolveConfig(
      {
        extends: ["recommended"],
        ignore: [
          {
            rule: "layout/text-overlap",
            file: "./decks/deck.pptx",
            slide: 3,
            shapeIds: [22, 18],
            reason: "Intentional label overlay",
          },
        ],
      },
      { resolveFileInputKey: resolvePosixFileInputKey },
    );

    const result = applySuppressions(
      [pairFinding()],
      "decks/deck.pptx",
      config.ignore,
    );

    expect(config.ignore[0]?.shapeIds).toEqual([18, 22]);
    expect(result.findings).toEqual([]);
    expect(result.suppressedFindings).toEqual([
      expect.objectContaining({
        suppressionIndex: 0,
        reason: "Intentional label overlay",
      }),
    ]);
    expect(result.unusedSuppressions).toEqual([]);
  });

  it("requires every supplied selector to match and exposes unused entries", () => {
    const config = resolveConfig({
      ignore: [
        {
          rule: "layout/text-overlap",
          slide: 4,
          shapeIds: [18, 22],
          reason: "Stale exception",
        },
      ],
    });

    const result = applySuppressions(
      [pairFinding()],
      "decks/deck.pptx",
      config.ignore,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.suppressedFindings).toEqual([]);
    expect(result.unusedSuppressions).toEqual([
      {
        suppressionIndex: 0,
        ruleId: "layout/text-overlap",
        reason: "Stale exception",
      },
    ]);
  });

  it("does not report suppressions scoped to another file as unused", () => {
    const config = resolveConfig(
      {
        ignore: [
          {
            rule: "layout/text-overlap",
            file: "decks/other.pptx",
            slide: 3,
            reason: "Belongs to another deck",
          },
        ],
      },
      { resolveFileInputKey: resolvePosixFileInputKey },
    );

    const result = applySuppressions(
      [pairFinding()],
      "decks/deck.pptx",
      config.ignore,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.suppressedFindings).toEqual([]);
    expect(result.unusedSuppressions).toEqual([]);
  });

  it("encodes raw file selectors with the same canonical form as input keys", () => {
    const config = resolveConfig(
      {
        ignore: [
          {
            rule: "layout/text-overlap",
            file: "./decks/a%b:c\\d.pptx",
            slide: 3,
          },
        ],
      },
      { resolveFileInputKey: resolvePosixFileInputKey },
    );

    expect(config.ignore[0]?.file).toBe("decks/a%25b%3Ac%5Cd.pptx");
    const result = applySuppressions(
      [pairFinding()],
      "decks/a%25b%3Ac%5Cd.pptx",
      config.ignore,
    );
    expect(result.findings).toEqual([]);
    expect(result.suppressedFindings).toHaveLength(1);
    expect(result.unusedSuppressions).toEqual([]);

    const windowsConfig = resolveConfig(
      {
        ignore: [
          {
            rule: "layout/text-overlap",
            file: "decks\\a%b:c.pptx",
          },
        ],
      },
      {
        resolveFileInputKey: (file) =>
          normalizeInputKey(encodeInputKeyPath(file, "\\")),
      },
    );
    expect(windowsConfig.ignore[0]?.file).toBe("decks/a%25b%3Ac.pptx");
  });

  it("requires an explicit file resolver in the programmatic API", () => {
    expect(() =>
      resolveConfig({
        ignore: [
          {
            rule: "layout/text-overlap",
            file: "decks\\legacy.pptx",
          },
        ],
      }),
    ).toThrow("ResolveConfigOptions.resolveFileInputKey");
  });

  it.each([
    [{ ignore: [] }, ""],
    [{ ignore: [{ rule: "layout/text-overlap" }] }, "location selector"],
    [
      {
        ignore: [{ rule: "layout/text-overlap", slide: 1, shapeIds: [2, 2] }],
      },
      "duplicates",
    ],
    [{ ignore: [{ rule: "unknown/rule", slide: 1 }] }, "known rule ID"],
    [
      { ignore: [{ rule: "layout/text-overlap", slide: 1, regex: ".*" }] },
      "unknown property",
    ],
  ])("validates suppression config %#", (value, message) => {
    if (message === "") {
      expect(resolveConfig(value).ignore).toEqual([]);
    } else {
      expect(() => resolveConfig(value)).toThrow(message);
    }
  });
});

describe("baseline lifecycle", () => {
  it("classifies existing, new, and resolved findings for one input", async () => {
    const initial = await lint(missingMediaPptx(1));
    const baseline = createBaseline([initial]);

    const unchanged = await lint(missingMediaPptx(1), baseline);
    expect(unchanged.findings).toEqual([
      expect.objectContaining({ status: "existing" }),
    ]);
    expect(unchanged.summary).toMatchObject({
      new: { errors: 0, warnings: 0, total: 0 },
      existing: { errors: 1, warnings: 0, total: 1 },
      resolved: 0,
      suppressed: 0,
    });
    expect(determineExitCode(unchanged, "error")).toBe(0);

    const added = await lint(missingMediaPptx(2), baseline);
    expect(added.findings.map((finding) => finding.status).sort()).toEqual([
      "existing",
      "new",
    ]);
    expect(added.summary.new.total).toBe(1);
    expect(determineExitCode(added, "error")).toBe(1);

    const removed = await lint(buildMinimalPptx(), baseline);
    expect(removed.findings).toEqual([]);
    expect(removed.resolvedFindings).toHaveLength(1);
    expect(removed.summary.resolved).toBe(1);
    expect(determineExitCode(removed, "error")).toBe(0);
  });

  it("lets an existing gating package finding explain partial analysis", async () => {
    const first = await lint(buildMinimalPptx({ slideXml: "<p:sld>" }));
    expect(first.analysisComplete).toBe(false);
    expect(determineExitCode(first, "error")).toBe(1);

    const unchanged = await lint(
      buildMinimalPptx({ slideXml: "<p:sld>" }),
      createBaseline([first]),
    );

    expect(unchanged.findings).toEqual([
      expect.objectContaining({
        ruleId: "package/malformed-xml",
        status: "existing",
      }),
    ]);
    expect(unchanged.analysisComplete).toBe(false);
    expect(determineExitCode(unchanged, "error")).toBe(0);
  });

  it("lets a suppressed package finding explain partial analysis", async () => {
    const report = await lintPptx(
      {
        bytes: buildMinimalPptx({ slideXml: "<p:sld>" }),
        displayPath: "malformed.pptx",
        inputKey: "malformed.pptx",
      },
      {
        config: resolveConfig({
          extends: ["recommended"],
          ignore: [
            {
              rule: "package/malformed-xml",
              part: "ppt/slides/slide1.xml",
              reason: "Known malformed producer output",
            },
          ],
        }),
      },
    );

    expect(report.analysisComplete).toBe(false);
    expect(report.findings).toEqual([]);
    expect(report.suppressedFindings).toHaveLength(1);
    expect(report.suppressedFindings[0]?.finding.ruleId).toBe(
      "package/malformed-xml",
    );
    expect(determineExitCode(report, "error")).toBe(0);
  });

  it("applies suppressions before comparison and baseline creation", async () => {
    const initial = await lint(missingMediaPptx(1));
    const baseline = createBaseline([initial]);
    const suppressed = await lintPptx(
      {
        bytes: missingMediaPptx(1),
        displayPath: "legacy.pptx",
        inputKey: "legacy.pptx",
      },
      {
        baseline,
        config: resolveConfig({
          extends: ["recommended"],
          ignore: [
            {
              rule: "package/missing-media",
              slide: 1,
              reason: "Known external asset handoff",
            },
          ],
        }),
      },
    );

    expect(suppressed.findings).toEqual([]);
    expect(suppressed.summary.suppressed).toBe(1);
    expect(suppressed.summary.resolved).toBe(1);
    expect(suppressed.unusedSuppressions).toEqual([]);
    expect(createBaseline([suppressed]).inputs[0]?.findings).toEqual([]);
  });

  it("writes deterministic minimal data and round-trips validation", async () => {
    const report = await lintPptx(
      {
        bytes: missingMediaPptx(1),
        displayPath: "/Users/alice/private/legacy.pptx",
        inputKey: "decks/legacy.pptx",
      },
      { config: resolveConfig() },
    );
    const secondReport = await lintPptx(
      {
        bytes: missingMediaPptx(1),
        displayPath: "/Users/alice/private/another.pptx",
        inputKey: "decks/another.pptx",
      },
      { config: resolveConfig() },
    );
    const baseline = createBaseline([report, secondReport]);
    const serialized = JSON.stringify(baseline);

    expect(createBaseline([secondReport, report])).toEqual(baseline);
    expect(parseBaseline(JSON.parse(serialized) as unknown)).toEqual(baseline);
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("evidence");
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("shapeNames");
    expect(baseline.inputs.map((input) => input.inputKey)).toEqual([
      "decks/another.pptx",
      "decks/legacy.pptx",
    ]);
  });

  it("rejects conflicting reports with the same input key", async () => {
    const first = await lint(missingMediaPptx(1));
    const second = await lint(missingMediaPptx(2));

    expect(() => createBaseline([first, second])).toThrow(BaselineError);
    expect(() => createBaseline([first, second])).toThrow("different source");
  });

  it.each([
    [{ schemaVersion: 2, toolMajorVersion: 0, inputs: [] }, "schemaVersion"],
    [{ schemaVersion: 3, toolMajorVersion: 1, inputs: [] }, "toolMajorVersion"],
    [
      {
        schemaVersion: 3,
        toolMajorVersion: 0,
        inputs: [
          {
            inputKey: "/absolute/deck.pptx",
            findings: [],
          },
        ],
      },
      "relative path",
    ],
  ])("rejects incompatible or unsafe baseline %#", (value, message) => {
    expect(() => parseBaseline(value)).toThrow(BaselineError);
    expect(() => parseBaseline(value)).toThrow(message);
  });
});

function pairFinding(): PptxFinding {
  return {
    ruleId: "layout/text-overlap",
    severity: "error",
    status: "new",
    message: "Two transformed text frames overlap.",
    file: "decks/deck.pptx",
    location: {
      part: "ppt/slides/slide3.xml",
      slideNumber: 3,
      slideId: "300",
      shapeIds: [18, 22],
      shapeNames: ["Label", "Value"],
    },
    evidence: { extractedSlideText: "must never enter a baseline" },
    fingerprint: "a".repeat(64),
  };
}

function resolvePosixFileInputKey(file: string): string {
  return normalizeInputKey(encodeInputKeyPath(file, "/"));
}

async function lint(
  bytes: Uint8Array,
  baseline?: ReturnType<typeof createBaseline>,
) {
  return lintPptx(
    {
      bytes,
      displayPath: "legacy.pptx",
      inputKey: "legacy.pptx",
    },
    {
      config: resolveConfig(),
      ...(baseline === undefined ? {} : { baseline }),
    },
  );
}

function missingMediaPptx(count: 1 | 2): Uint8Array {
  const second =
    count === 1
      ? ""
      : `<Relationship Id="rId9" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/also-missing.png"/>`;
  const relationships = `<?xml version="1.0"?>
    <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/missing.png"/>
      ${second}
    </Relationships>`;
  return buildRawZip(
    minimalPptxEntries(minimalSlideXml()).map((entry) =>
      entry.name === "ppt/slides/_rels/slide1.xml.rels"
        ? { ...entry, data: relationships }
        : entry,
    ),
  );
}
