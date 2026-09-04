import { normalizeInputKey } from "../context/context.js";
import {
  RULE_IDS,
  type FindingLocation,
  type LintReport,
  type PptxFinding,
  type ResolvedFinding,
  type RuleId,
} from "../lint/types.js";
import { canonicalizeEntryPartName } from "../opc/path.js";

export const BASELINE_SCHEMA_VERSION = 3 as const;
export const TOOL_MAJOR_VERSION = 0 as const;

export type BaselineFinding = ResolvedFinding;

export interface BaselineInput {
  readonly inputKey: string;
  readonly findings: readonly BaselineFinding[];
}

export interface BaselineV3 {
  readonly schemaVersion: typeof BASELINE_SCHEMA_VERSION;
  readonly toolMajorVersion: typeof TOOL_MAJOR_VERSION;
  readonly inputs: readonly BaselineInput[];
}

export interface BaselineClassification {
  readonly findings: readonly PptxFinding[];
  readonly resolvedFindings: readonly BaselineFinding[];
}

export class BaselineError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BaselineError";
  }
}

export function createBaseline(reports: readonly LintReport[]): BaselineV3 {
  const grouped = new Map<
    string,
    {
      readonly sourceSha256: string;
      readonly findings: Map<string, BaselineFinding>;
    }
  >();
  for (const report of reports) {
    let group = grouped.get(report.input.inputKey);
    if (group === undefined) {
      group = {
        sourceSha256: report.input.sourceSha256,
        findings: new Map(),
      };
      grouped.set(report.input.inputKey, group);
    } else if (group.sourceSha256 !== report.input.sourceSha256) {
      throw new BaselineError(
        `Cannot merge reports with inputKey ${JSON.stringify(report.input.inputKey)} and different source SHA-256 values.`,
      );
    }
    for (const finding of report.findings) {
      group.findings.set(finding.fingerprint, {
        fingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        location: minimalLocation(finding.location),
      });
    }
  }

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    toolMajorVersion: TOOL_MAJOR_VERSION,
    inputs: [...grouped.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([inputKey, group]) => ({
        inputKey,
        findings: [...group.findings.values()].sort(compareBaselineFindings),
      })),
  };
}

export function parseBaseline(value: unknown): BaselineV3 {
  const baseline = objectValue(value, "Baseline");
  rejectUnknownKeys(baseline, ["inputs", "schemaVersion", "toolMajorVersion"]);
  if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new BaselineError(
      `Unsupported baseline schemaVersion ${JSON.stringify(baseline.schemaVersion)}; expected ${String(BASELINE_SCHEMA_VERSION)}.`,
    );
  }
  if (baseline.toolMajorVersion !== TOOL_MAJOR_VERSION) {
    throw new BaselineError(
      `Unsupported baseline toolMajorVersion ${JSON.stringify(baseline.toolMajorVersion)}; expected ${String(TOOL_MAJOR_VERSION)}.`,
    );
  }
  if (!Array.isArray(baseline.inputs)) {
    throw new BaselineError("Baseline inputs must be an array.");
  }

  const inputs = baseline.inputs.map((entry, index) =>
    parseBaselineInput(entry, index),
  );
  const inputKeys = new Set<string>();
  for (const input of inputs) {
    if (inputKeys.has(input.inputKey)) {
      throw new BaselineError(
        `Baseline contains duplicate inputKey ${JSON.stringify(input.inputKey)}.`,
      );
    }
    inputKeys.add(input.inputKey);
  }

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    toolMajorVersion: TOOL_MAJOR_VERSION,
    inputs: inputs.sort((left, right) =>
      compareText(left.inputKey, right.inputKey),
    ),
  };
}

export function classifyBaseline(
  findings: readonly PptxFinding[],
  inputKey: string,
  baseline?: BaselineV3,
): BaselineClassification {
  const baselineInput = baseline?.inputs.find(
    (candidate) => candidate.inputKey === inputKey,
  );
  if (baselineInput === undefined) {
    return {
      findings: findings.map((finding) => ({ ...finding, status: "new" })),
      resolvedFindings: [],
    };
  }

  const baselineFingerprints = new Set(
    baselineInput.findings.map((finding) => finding.fingerprint),
  );
  const currentFingerprints = new Set(
    findings.map((finding) => finding.fingerprint),
  );
  return {
    findings: findings.map((finding) => ({
      ...finding,
      status: baselineFingerprints.has(finding.fingerprint)
        ? "existing"
        : "new",
    })),
    resolvedFindings: baselineInput.findings.filter(
      (finding) => !currentFingerprints.has(finding.fingerprint),
    ),
  };
}

function parseBaselineInput(value: unknown, inputIndex: number): BaselineInput {
  const input = objectValue(value, `Baseline inputs[${String(inputIndex)}]`);
  rejectUnknownKeys(input, ["findings", "inputKey"]);
  if (typeof input.inputKey !== "string") {
    throw new BaselineError(
      `Baseline inputs[${String(inputIndex)}].inputKey must be a string.`,
    );
  }
  let inputKey: string;
  try {
    inputKey = normalizeInputKey(input.inputKey);
  } catch (error) {
    throw new BaselineError(
      `Baseline inputs[${String(inputIndex)}].inputKey is invalid: ${errorMessage(error)}`,
    );
  }
  if (!Array.isArray(input.findings)) {
    throw new BaselineError(
      `Baseline inputs[${String(inputIndex)}].findings must be an array.`,
    );
  }
  const findings = input.findings.map((finding, findingIndex) =>
    parseBaselineFinding(finding, inputIndex, findingIndex),
  );
  const fingerprints = new Set<string>();
  for (const finding of findings) {
    if (fingerprints.has(finding.fingerprint)) {
      throw new BaselineError(
        `Baseline input ${JSON.stringify(inputKey)} contains duplicate fingerprint ${JSON.stringify(finding.fingerprint)}.`,
      );
    }
    fingerprints.add(finding.fingerprint);
  }
  return { inputKey, findings: findings.sort(compareBaselineFindings) };
}

function parseBaselineFinding(
  value: unknown,
  inputIndex: number,
  findingIndex: number,
): BaselineFinding {
  const path = `Baseline inputs[${String(inputIndex)}].findings[${String(findingIndex)}]`;
  const finding = objectValue(value, path);
  rejectUnknownKeys(finding, ["fingerprint", "location", "ruleId"]);
  if (
    typeof finding.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(finding.fingerprint)
  ) {
    throw new BaselineError(
      `${path}.fingerprint must be a SHA-256 hex string.`,
    );
  }
  if (!isRuleId(finding.ruleId)) {
    throw new BaselineError(`${path}.ruleId must be a known rule ID.`);
  }
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    location: parseLocation(finding.location, `${path}.location`),
  };
}

function parseLocation(value: unknown, path: string): FindingLocation {
  const location = objectValue(value, path);
  rejectUnknownKeys(location, [
    "paragraphIndex",
    "part",
    "runIndex",
    "shapeIds",
    "slideId",
    "slideNumber",
  ]);
  const part = optionalString(location.part, `${path}.part`);
  const slideId = optionalString(location.slideId, `${path}.slideId`);
  const slideNumber = optionalInteger(
    location.slideNumber,
    `${path}.slideNumber`,
    1,
  );
  const paragraphIndex = optionalInteger(
    location.paragraphIndex,
    `${path}.paragraphIndex`,
    0,
  );
  const runIndex = optionalInteger(location.runIndex, `${path}.runIndex`, 0);
  const shapeIds = optionalIntegerArray(location.shapeIds, `${path}.shapeIds`);
  let canonicalPart: string | undefined;
  if (part !== undefined) {
    const result = canonicalizeEntryPartName(part);
    if (!result.ok) throw new BaselineError(`${path}.part: ${result.message}`);
    canonicalPart = result.partName;
  }
  return {
    ...(canonicalPart === undefined ? {} : { part: canonicalPart }),
    ...(slideNumber === undefined ? {} : { slideNumber }),
    ...(slideId === undefined ? {} : { slideId }),
    ...(shapeIds === undefined ? {} : { shapeIds }),
    ...(paragraphIndex === undefined ? {} : { paragraphIndex }),
    ...(runIndex === undefined ? {} : { runIndex }),
  };
}

function minimalLocation(location: FindingLocation): FindingLocation {
  return {
    ...(location.part === undefined ? {} : { part: location.part }),
    ...(location.slideNumber === undefined
      ? {}
      : { slideNumber: location.slideNumber }),
    ...(location.slideId === undefined ? {} : { slideId: location.slideId }),
    ...(location.shapeIds === undefined
      ? {}
      : {
          shapeIds: [...location.shapeIds].sort((left, right) => left - right),
        }),
    ...(location.paragraphIndex === undefined
      ? {}
      : { paragraphIndex: location.paragraphIndex }),
    ...(location.runIndex === undefined ? {} : { runIndex: location.runIndex }),
  };
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new BaselineError(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalInteger(
  value: unknown,
  path: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isInteger(value) ||
    typeof value !== "number" ||
    value < minimum
  ) {
    throw new BaselineError(
      `${path} must be an integer greater than or equal to ${String(minimum)}.`,
    );
  }
  return value;
}

function optionalIntegerArray(
  value: unknown,
  path: string,
): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => !Number.isInteger(entry) || entry < 0)
  ) {
    throw new BaselineError(
      `${path} must be a non-empty array of non-negative integers.`,
    );
  }
  const shapeIds = value as number[];
  if (new Set(shapeIds).size !== shapeIds.length) {
    throw new BaselineError(`${path} must not contain duplicates.`);
  }
  return [...shapeIds].sort((left, right) => left - right);
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BaselineError(`${path} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw new BaselineError(
      `Unknown baseline property ${JSON.stringify(unknown)}.`,
    );
  }
}

function isRuleId(value: unknown): value is RuleId {
  return (
    typeof value === "string" && RULE_IDS.some((ruleId) => ruleId === value)
  );
}

function compareBaselineFindings(
  left: BaselineFinding,
  right: BaselineFinding,
): number {
  return (
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.fingerprint, right.fingerprint)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
