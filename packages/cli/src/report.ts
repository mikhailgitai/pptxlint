import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import type {
  LintReport,
  LintReportSummary,
  ResolvedConfig,
  SeverityCounts,
} from "@pptxlint/core";

export const COMMAND_REPORT_SCHEMA_VERSION = 1 as const;
export const TOOL_VERSION = readPackageVersion();

export interface CommandReport {
  readonly schemaVersion: typeof COMMAND_REPORT_SCHEMA_VERSION;
  readonly toolVersion: string;
  readonly configHash: string;
  readonly analysisComplete: boolean;
  readonly inputs: readonly LintReport[];
  readonly summary: LintReportSummary;
  readonly timingsMs: Readonly<Record<string, number>>;
  readonly peakRssBytes?: number;
}

export interface CreateCommandReportOptions {
  readonly configHash: string;
  readonly timingsMs?: Readonly<Record<string, number>>;
  readonly peakRssBytes?: number;
  readonly toolVersion?: string;
}

export function createCommandReport(
  reports: readonly LintReport[],
  options: CreateCommandReportOptions,
): CommandReport {
  const inputs = [...reports].sort(compareReports);
  const peakRssBytes = options.peakRssBytes;
  if (
    peakRssBytes !== undefined &&
    (!Number.isSafeInteger(peakRssBytes) || peakRssBytes < 0)
  ) {
    throw new TypeError("peakRssBytes must be a non-negative safe integer.");
  }
  return {
    schemaVersion: COMMAND_REPORT_SCHEMA_VERSION,
    toolVersion: options.toolVersion ?? TOOL_VERSION,
    configHash: options.configHash,
    analysisComplete: inputs.every((report) => report.analysisComplete),
    inputs,
    summary: inputs.reduce<LintReportSummary>(
      (summary, report) => ({
        errors: summary.errors + report.summary.errors,
        warnings: summary.warnings + report.summary.warnings,
        total: summary.total + report.summary.total,
        new: addSeverityCounts(summary.new, report.summary.new),
        existing: addSeverityCounts(summary.existing, report.summary.existing),
        resolved: summary.resolved + report.summary.resolved,
        suppressed: summary.suppressed + report.summary.suppressed,
      }),
      {
        errors: 0,
        warnings: 0,
        total: 0,
        new: emptySeverityCounts(),
        existing: emptySeverityCounts(),
        resolved: 0,
        suppressed: 0,
      },
    ),
    timingsMs: canonicalTimings(options.timingsMs ?? {}),
    ...(peakRssBytes === undefined ? {} : { peakRssBytes }),
  };
}

export function createConfigHash(config: ResolvedConfig): string {
  const canonicalConfig = {
    schemaVersion: config.schemaVersion,
    failOn: config.failOn,
    rules: [...config.rules.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([ruleId, rule]) => ({
        ruleId,
        enabled: rule.enabled,
        severity: rule.severity,
        options: canonicalJsonValue(rule.options),
      })),
    ignore: config.ignore.map((suppression) => canonicalJsonValue(suppression)),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalConfig))
    .digest("hex");
}

function compareReports(left: LintReport, right: LintReport): number {
  return (
    compareText(left.input.inputKey, right.input.inputKey) ||
    compareText(left.input.file, right.input.file) ||
    compareText(left.input.sourceSha256, right.input.sourceSha256)
  );
}

function canonicalTimings(
  timings: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(timings)
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, milliseconds]) => {
        if (!Number.isFinite(milliseconds) || milliseconds < 0) {
          throw new TypeError(
            `Timing ${JSON.stringify(name)} must be a non-negative finite number.`,
          );
        }
        return [name, Math.round(milliseconds * 1000) / 1000];
      }),
  );
}

function canonicalJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Resolved config contains a non-finite number.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  throw new TypeError(
    `Resolved config contains unsupported value of type ${typeof value}.`,
  );
}

function emptySeverityCounts(): SeverityCounts {
  return { errors: 0, warnings: 0, total: 0 };
}

function addSeverityCounts(
  left: SeverityCounts,
  right: SeverityCounts,
): SeverityCounts {
  return {
    errors: left.errors + right.errors,
    warnings: left.warnings + right.warnings,
    total: left.total + right.total,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readPackageVersion(): string {
  const manifest = createRequire(import.meta.url)("../package.json") as {
    readonly version?: unknown;
  };
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      manifest.version,
    )
  ) {
    throw new TypeError("pptxlint package.json has an invalid version.");
  }
  return manifest.version;
}
