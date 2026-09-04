import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { REPORT_SCHEMA_VERSION, RULE_IDS } from "@pptxlint/core";
import { describe, expect, it } from "vitest";

import { COMMAND_REPORT_SCHEMA_VERSION } from "../src/report.js";

describe("command report JSON schema", () => {
  it("stays aligned with runtime versions and rule IDs", () => {
    const schema = JSON.parse(
      readFileSync(resolve("schemas/pptxlint-report.schema.json"), "utf8"),
    ) as unknown;
    const root = objectValue(schema, "report schema");
    const properties = objectValue(root.properties, "report properties");
    const schemaVersion = objectValue(
      properties.schemaVersion,
      "report schemaVersion",
    );
    expect(schemaVersion.const).toBe(COMMAND_REPORT_SCHEMA_VERSION);

    const definitions = objectValue(root.$defs, "$defs");
    const inputReport = objectValue(definitions.inputReport, "inputReport");
    const inputProperties = objectValue(
      inputReport.properties,
      "inputReport properties",
    );
    const inputSchemaVersion = objectValue(
      inputProperties.schemaVersion,
      "inputReport schemaVersion",
    );
    expect(inputSchemaVersion.const).toBe(REPORT_SCHEMA_VERSION);

    const ruleId = objectValue(definitions.ruleId, "ruleId");
    expect((ruleId.enum as unknown[]).sort()).toEqual([...RULE_IDS].sort());

    const peakRssBytes = objectValue(
      properties.peakRssBytes,
      "report peakRssBytes",
    );
    expect(peakRssBytes).toMatchObject({ type: "integer", minimum: 0 });
  });
});

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}
