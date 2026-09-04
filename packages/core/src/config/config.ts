import { RULE_REGISTRY } from "../rules/registry.js";
import { normalizeInputKey } from "../context/context.js";
import type { RuleId, RuleSeverity, Severity } from "../lint/types.js";
import { canonicalizeEntryPartName } from "../opc/path.js";
import type { Suppression } from "../suppressions/suppressions.js";

export interface ResolvedRuleConfig<Options = unknown> {
  readonly enabled: boolean;
  readonly severity: Severity;
  readonly options: Options;
}

export interface ResolvedConfig {
  readonly schemaVersion: 1;
  readonly failOn: Severity;
  readonly rules: ReadonlyMap<RuleId, ResolvedRuleConfig>;
  readonly ignore: readonly Suppression[];
}

export interface ResolveConfigOptions {
  readonly resolveFileInputKey?: (file: string) => string;
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function resolveConfig(
  value?: unknown,
  options: ResolveConfigOptions = {},
): ResolvedConfig {
  if (value === undefined) {
    return resolveConfig({ extends: ["recommended"] }, options);
  }
  if (!isObject(value)) throw new ConfigError("Config must be a JSON object.");

  rejectUnknownKeys(value, [
    "$schema",
    "extends",
    "failOn",
    "ignore",
    "rules",
    "schemaVersion",
  ]);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new ConfigError("schemaVersion must be 1.");
  }
  if (value.$schema !== undefined && typeof value.$schema !== "string") {
    throw new ConfigError("$schema must be a string.");
  }

  const rules = new Map<RuleId, ResolvedRuleConfig>();
  for (const rule of RULE_REGISTRY) {
    const defaultSeverity = rule.descriptor.defaultSeverity;
    rules.set(rule.descriptor.id, {
      enabled: false,
      severity: defaultSeverity === "off" ? "error" : defaultSeverity,
      options: rule.descriptor.defaultOptions,
    });
  }

  const presetNames = parseExtends(value.extends);
  if (presetNames.includes("recommended")) {
    for (const rule of RULE_REGISTRY) {
      const severity = rule.descriptor.defaultSeverity;
      if (severity !== "off") {
        rules.set(rule.descriptor.id, {
          enabled: true,
          severity,
          options: rule.descriptor.defaultOptions,
        });
      }
    }
  }

  const configuredRules = value.rules;
  if (configuredRules !== undefined) {
    if (!isObject(configuredRules)) {
      throw new ConfigError("rules must be a JSON object.");
    }
    for (const [ruleName, ruleValue] of Object.entries(configuredRules)) {
      const rule = RULE_REGISTRY.find(
        (candidate) => candidate.descriptor.id === ruleName,
      );
      if (rule === undefined) {
        throw new ConfigError(`Unknown rule ${JSON.stringify(ruleName)}.`);
      }
      const parsed = parseRuleValue(ruleName, ruleValue);
      let options: unknown;
      if (parsed.severity === "off" && parsed.options === undefined) {
        options = rule.descriptor.defaultOptions;
      } else {
        try {
          options = rule.descriptor.validateOptions(
            "options" in parsed ? parsed.options : {},
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new ConfigError(`${ruleName}: ${detail}`);
        }
      }
      rules.set(rule.descriptor.id, {
        enabled: parsed.severity !== "off",
        severity: parsed.severity === "off" ? "error" : parsed.severity,
        options,
      });
    }
  }

  return {
    schemaVersion: 1,
    failOn: parseSeverity(value.failOn ?? "error", "failOn"),
    rules,
    ignore: parseSuppressions(value.ignore, options.resolveFileInputKey),
  };
}

export function withFailOn(
  config: ResolvedConfig,
  failOn: Severity,
): ResolvedConfig {
  return { ...config, failOn };
}

function parseExtends(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new ConfigError("extends must be an array of preset names.");
  }
  const presetNames = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  if (new Set(presetNames).size !== presetNames.length) {
    throw new ConfigError("extends must not contain duplicate presets.");
  }
  for (const preset of presetNames) {
    if (preset !== "recommended") {
      throw new ConfigError(`Unknown preset ${JSON.stringify(preset)}.`);
    }
  }
  return presetNames;
}

function parseRuleValue(
  ruleId: string,
  value: unknown,
): { readonly severity: RuleSeverity; readonly options?: unknown } {
  if (typeof value === "string") {
    return { severity: parseRuleSeverity(value, ruleId) };
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new ConfigError(
      `${ruleId} must be a severity or [severity, options].`,
    );
  }
  return {
    severity: parseRuleSeverity(value[0], ruleId),
    ...(value.length === 1 ? {} : { options: value[1] }),
  };
}

function parseSeverity(value: unknown, field: string): Severity {
  if (value !== "error" && value !== "warning") {
    throw new ConfigError(`${field} must be "warning" or "error".`);
  }
  return value;
}

function parseRuleSeverity(value: unknown, field: string): RuleSeverity {
  if (value === "off") return value;
  return parseSeverity(value, field);
}

function parseSuppressions(
  value: unknown,
  resolveFileInputKey: ResolveConfigOptions["resolveFileInputKey"],
): readonly Suppression[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ConfigError("ignore must be an array of suppressions.");
  }
  return value.map((entry, index) =>
    parseSuppression(entry, index, resolveFileInputKey),
  );
}

function parseSuppression(
  value: unknown,
  index: number,
  resolveFileInputKey: ResolveConfigOptions["resolveFileInputKey"],
): Suppression {
  const path = `ignore[${String(index)}]`;
  if (!isObject(value)) {
    throw new ConfigError(`${path} must be a JSON object.`);
  }
  const allowed = [
    "file",
    "part",
    "reason",
    "rule",
    "shapeIds",
    "slide",
    "slideId",
  ];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw new ConfigError(
      `${path} has unknown property ${JSON.stringify(unknown)}.`,
    );
  }
  const rule = RULE_REGISTRY.find(
    (candidate) => candidate.descriptor.id === value.rule,
  )?.descriptor.id;
  if (rule === undefined) {
    throw new ConfigError(`${path}.rule must be a known rule ID.`);
  }

  const file = optionalNonEmptyString(value.file, `${path}.file`);
  const slideId = optionalNonEmptyString(value.slideId, `${path}.slideId`);
  const part = optionalNonEmptyString(value.part, `${path}.part`);
  const reason = optionalNonEmptyString(value.reason, `${path}.reason`);
  const slide = optionalInteger(value.slide, `${path}.slide`, 1);
  const shapeIds = optionalShapeIds(value.shapeIds, `${path}.shapeIds`);
  if (
    file === undefined &&
    slide === undefined &&
    slideId === undefined &&
    shapeIds === undefined &&
    part === undefined
  ) {
    throw new ConfigError(
      `${path} must include at least one location selector.`,
    );
  }

  let normalizedFile: string | undefined;
  if (file !== undefined) {
    if (resolveFileInputKey === undefined) {
      throw new ConfigError(
        `${path}.file requires ResolveConfigOptions.resolveFileInputKey.`,
      );
    }
    try {
      normalizedFile = normalizeInputKey(resolveFileInputKey(file));
    } catch (error) {
      throw new ConfigError(`${path}.file is invalid: ${errorMessage(error)}`);
    }
  }
  let canonicalPart: string | undefined;
  if (part !== undefined) {
    const result = canonicalizeEntryPartName(part);
    if (!result.ok) throw new ConfigError(`${path}.part: ${result.message}`);
    canonicalPart = result.partName;
  }

  return {
    rule,
    ...(normalizedFile === undefined ? {} : { file: normalizedFile }),
    ...(slide === undefined ? {} : { slide }),
    ...(slideId === undefined ? {} : { slideId }),
    ...(shapeIds === undefined ? {} : { shapeIds }),
    ...(canonicalPart === undefined ? {} : { part: canonicalPart }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function optionalNonEmptyString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    throw new ConfigError(
      `${field} must be an integer greater than or equal to ${String(minimum)}.`,
    );
  }
  return value;
}

function optionalShapeIds(
  value: unknown,
  field: string,
): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) =>
        typeof entry !== "number" || !Number.isInteger(entry) || entry < 0,
    )
  ) {
    throw new ConfigError(
      `${field} must be a non-empty array of non-negative integers.`,
    );
  }
  const shapeIds = value as number[];
  if (new Set(shapeIds).size !== shapeIds.length) {
    throw new ConfigError(`${field} must not contain duplicates.`);
  }
  return [...shapeIds].sort((left, right) => left - right);
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw new ConfigError(
      `Unknown config property ${JSON.stringify(unknown)}.`,
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
