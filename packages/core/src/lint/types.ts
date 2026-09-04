import type { ContextDiagnostic } from "../context/types.js";

export const REPORT_SCHEMA_VERSION = 1 as const;

export const PACKAGE_RULE_IDS = [
  "package/broken-relationship",
  "package/missing-media",
  "package/malformed-xml",
] as const;

export const LAYOUT_RULE_IDS = [
  "layout/outside-slide",
  "layout/text-overlap",
  "layout/text-occluded",
] as const;

export const TEXT_RULE_IDS = [
  "text/min-font-size",
  "text/autofit-scale-below-minimum",
  "text/autofit-enabled",
] as const;

export const FONT_RULE_IDS = ["fonts/allowed"] as const;

export const RULE_IDS = [
  ...PACKAGE_RULE_IDS,
  ...LAYOUT_RULE_IDS,
  ...TEXT_RULE_IDS,
  ...FONT_RULE_IDS,
] as const;

export type RuleId = (typeof RULE_IDS)[number];
export type Severity = "error" | "warning";
export type RuleSeverity = "off" | Severity;
export type FindingStatus = "existing" | "new";

export type FindingEvidenceValue =
  | boolean
  | null
  | number
  | string
  | FindingEvidenceObject
  | readonly FindingEvidenceValue[];

export interface FindingEvidenceObject {
  readonly [key: string]: FindingEvidenceValue;
}

export type FindingEvidence = FindingEvidenceObject;

export interface FindingLocation {
  readonly part?: string;
  readonly slideNumber?: number;
  readonly slideId?: string;
  readonly shapeIds?: readonly number[];
  readonly shapeNames?: readonly string[];
  readonly paragraphIndex?: number;
  readonly runIndex?: number;
}

export interface PptxFinding {
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly status: FindingStatus;
  readonly message: string;
  readonly file: string;
  readonly location: FindingLocation;
  readonly evidence: FindingEvidence;
  readonly fingerprint: string;
}

export interface LintInput {
  readonly bytes: Uint8Array;
  readonly displayPath: string;
  readonly inputKey: string;
}

export interface LintReportInput {
  readonly file: string;
  readonly inputKey: string;
  readonly sourceSha256: string;
}

export interface LintReportSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly total: number;
  readonly new: SeverityCounts;
  readonly existing: SeverityCounts;
  readonly resolved: number;
  readonly suppressed: number;
}

export interface SeverityCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly total: number;
}

export interface SuppressedFinding {
  readonly finding: PptxFinding;
  readonly suppressionIndex: number;
  readonly reason?: string;
}

export interface UnusedSuppression {
  readonly suppressionIndex: number;
  readonly ruleId: RuleId;
  readonly reason?: string;
}

export interface ResolvedFinding {
  readonly fingerprint: string;
  readonly ruleId: RuleId;
  readonly location: FindingLocation;
}

export interface LintReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly input: LintReportInput;
  readonly findings: readonly PptxFinding[];
  readonly suppressedFindings: readonly SuppressedFinding[];
  readonly unusedSuppressions: readonly UnusedSuppression[];
  readonly resolvedFindings: readonly ResolvedFinding[];
  readonly diagnostics: readonly ContextDiagnostic[];
  readonly skippedRules: readonly RuleId[];
  readonly analysisComplete: boolean;
  readonly summary: LintReportSummary;
}
