import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BASELINE_SCHEMA_VERSION, RULE_IDS } from "../src/index.js";

describe("configuration JSON schema", () => {
  it("lists every runtime rule ID exactly once", () => {
    const schema = JSON.parse(
      readFileSync(resolve("schemas/pptxlint.schema.json"), "utf8"),
    ) as unknown;
    const root = objectValue(schema, "schema");
    const properties = objectValue(root.properties, "properties");
    const rules = objectValue(properties.rules, "rules");
    const ruleProperties = objectValue(rules.properties, "rule properties");

    expect(Object.keys(ruleProperties).sort()).toEqual([...RULE_IDS].sort());

    const definitions = objectValue(root.$defs, "$defs");
    const ruleId = objectValue(definitions.ruleId, "ruleId");
    expect((ruleId.enum as unknown[]).sort()).toEqual([...RULE_IDS].sort());
  });

  it("keeps the baseline JSON schema version aligned with runtime", () => {
    const schema = JSON.parse(
      readFileSync(resolve("schemas/pptxlint-baseline.schema.json"), "utf8"),
    ) as unknown;
    const root = objectValue(schema, "baseline schema");
    const properties = objectValue(root.properties, "baseline properties");
    const schemaVersion = objectValue(
      properties.schemaVersion,
      "baseline schemaVersion",
    );

    expect(schemaVersion.const).toBe(BASELINE_SCHEMA_VERSION);
  });
});

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}
