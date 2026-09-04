import { REPORT_SCHEMA_VERSION } from "@pptxlint/core";
import { describe, expect, it } from "vitest";

import { createSarifLog } from "../src/formatters/sarif.js";
import {
  COMMAND_REPORT_SCHEMA_VERSION,
  type CommandReport,
} from "../src/report.js";

describe("SARIF formatter", () => {
  it("publishes calibrated default configurations", () => {
    const rules = createSarifLog(shapeReport()).runs[0]?.tool.driver.rules;

    expect(
      rules?.find((rule) => rule.id === "layout/text-overlap"),
    ).toMatchObject({
      defaultConfiguration: { enabled: true, level: "warning" },
    });
    expect(
      rules?.find((rule) => rule.id === "layout/text-occluded"),
    ).toMatchObject({
      defaultConfiguration: { enabled: false, level: "none" },
    });
  });

  it("represents PPTX shape locations without invented source regions", () => {
    const sarif = createSarifLog(shapeReport());
    const result = sarif.runs[0]?.results[0];

    expect(result).toMatchObject({
      ruleId: "layout/text-overlap",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "deck.pptx",
              uriBaseId: "%SRCROOT%",
              index: 0,
            },
          },
          logicalLocations: [
            {
              name: "slide 2 / shapes 18, 22",
              kind: "element",
              properties: {
                slideNumber: 2,
                slideId: "257",
                shapeIds: [18, 22],
              },
            },
          ],
          properties: {
            slideNumber: 2,
            slideId: "257",
            shapeIds: [18, 22],
          },
        },
      ],
    });
    expect(result?.locations[0]?.physicalLocation).not.toHaveProperty("region");
    expect(result).not.toHaveProperty("baselineState");
  });
});

function shapeReport(): CommandReport {
  const zeroCounts = { errors: 0, warnings: 0, total: 0 } as const;
  const newCounts = { errors: 1, warnings: 0, total: 1 } as const;
  const summary = {
    errors: 1,
    warnings: 0,
    total: 1,
    new: newCounts,
    existing: zeroCounts,
    resolved: 0,
    suppressed: 0,
  } as const;
  return {
    schemaVersion: COMMAND_REPORT_SCHEMA_VERSION,
    toolVersion: "0.1.0",
    configHash: "0".repeat(64),
    analysisComplete: true,
    inputs: [
      {
        schemaVersion: REPORT_SCHEMA_VERSION,
        input: {
          file: "deck.pptx",
          inputKey: "deck.pptx",
          sourceSha256: "1".repeat(64),
        },
        findings: [
          {
            ruleId: "layout/text-overlap",
            severity: "error",
            status: "new",
            message: "Text boxes overlap.",
            file: "deck.pptx",
            location: {
              part: "ppt/slides/slide2.xml",
              slideNumber: 2,
              slideId: "257",
              shapeIds: [18, 22],
              shapeNames: ["Body", "Chart label"],
            },
            evidence: { overlapRatio: 0.31 },
            fingerprint: "2".repeat(64),
          },
        ],
        suppressedFindings: [],
        unusedSuppressions: [],
        resolvedFindings: [],
        diagnostics: [],
        skippedRules: [],
        analysisComplete: true,
        summary,
      },
    ],
    summary,
    timingsMs: {},
  };
}
