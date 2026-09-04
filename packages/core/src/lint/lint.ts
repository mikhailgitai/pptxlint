import { classifyBaseline, type BaselineV3 } from "../baseline/baseline.js";
import type { ResolvedConfig } from "../config/config.js";
import { buildPptxContext } from "../context/context.js";
import type { ContextDiagnostic, PptxContext } from "../context/types.js";
import { normalizeInputKey } from "../context/context.js";
import { partNameComparisonKey } from "../opc/path.js";
import { relationshipsPartForSource } from "../relationships/relationships.js";
import { RULE_REGISTRY } from "../rules/registry.js";
import { applySuppressions } from "../suppressions/suppressions.js";
import { createFindingFingerprint } from "./fingerprint.js";
import type { ContextCapability, FindingDraft } from "./rule.js";
import type {
  FindingEvidence,
  FindingLocation,
  LintInput,
  LintReport,
  PptxFinding,
  RuleId,
  SeverityCounts,
  Severity,
} from "./types.js";
import { REPORT_SCHEMA_VERSION } from "./types.js";

export interface LintOptions {
  readonly config: ResolvedConfig;
  readonly baseline?: BaselineV3;
  /** Optional low-overhead observer used by CLI debug performance metadata. */
  readonly onTiming?: (name: LintTimingName, milliseconds: number) => void;
}

export type LintTimingName = "context" | RuleId;

export class UnsupportedInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedInputError";
  }
}

export async function lintPptx(
  input: LintInput,
  options: LintOptions,
): Promise<LintReport> {
  const inputKey = normalizeInputKey(input.inputKey);
  if (input.displayPath.trim() === "") {
    throw new TypeError("displayPath must be non-empty.");
  }
  const built = await measure(
    "context",
    () => buildPptxContext(input.bytes, { inputKey }),
    options.onTiming,
  );
  if (!built.ok) {
    throw new UnsupportedInputError(built.diagnostic.message);
  }

  const { context } = built;
  try {
    const findings: PptxFinding[] = [];
    const skippedRules: RuleId[] = [];
    for (const rule of RULE_REGISTRY) {
      const configured = options.config.rules.get(rule.descriptor.id);
      if (configured?.enabled !== true) continue;
      if (!hasPrerequisites(context, rule.descriptor.prerequisites)) {
        skippedRules.push(rule.descriptor.id);
        continue;
      }
      const drafts = await measure(
        rule.descriptor.id,
        () => rule.analyze(context, configured.options),
        options.onTiming,
      );
      for (const draft of drafts) {
        findings.push(
          await finalizeFinding(
            input.displayPath,
            inputKey,
            rule.descriptor.id,
            draft.severity ?? configured.severity,
            draft,
          ),
        );
      }
    }

    const unique = deduplicateFindings(findings).sort(compareFindings);
    const suppression = applySuppressions(
      unique,
      inputKey,
      options.config.ignore,
    );
    const classified = classifyBaseline(
      suppression.findings,
      inputKey,
      options.baseline,
    );
    const allCounts = countSeverities(classified.findings);
    const newCounts = countSeverities(
      classified.findings.filter((finding) => finding.status === "new"),
    );
    const existingCounts = countSeverities(
      classified.findings.filter((finding) => finding.status === "existing"),
    );
    const hasMalformedXml = unique.some(
      (finding) => finding.ruleId === "package/malformed-xml",
    );
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      input: {
        file: input.displayPath,
        inputKey,
        sourceSha256: context.identity.sourceSha256,
      },
      findings: classified.findings,
      suppressedFindings: suppression.suppressedFindings,
      unusedSuppressions: suppression.unusedSuppressions,
      resolvedFindings: classified.resolvedFindings,
      diagnostics: [...context.diagnostics].sort(compareDiagnostics),
      skippedRules,
      analysisComplete:
        context.analysisComplete &&
        !hasMalformedXml &&
        skippedRules.length === 0,
      summary: {
        ...allCounts,
        new: newCounts,
        existing: existingCounts,
        resolved: classified.resolvedFindings.length,
        suppressed: suppression.suppressedFindings.length,
      },
    };
  } finally {
    await context.close();
  }
}

async function measure<Result>(
  name: LintTimingName,
  operation: () => Promise<Result>,
  observer: LintOptions["onTiming"],
): Promise<Result> {
  if (observer === undefined) return operation();
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    observer(name, performance.now() - startedAt);
  }
}

export function determineExitCode(
  report: LintReport,
  failOn: Severity,
): 0 | 1 | 2 {
  const threshold = failOn === "error" ? 2 : 1;
  const gatingFindings = report.findings.filter(
    (finding) =>
      finding.status === "new" && severityRank(finding.severity) >= threshold,
  );
  const explanatoryFindings = [
    ...report.findings.filter(
      (finding) => severityRank(finding.severity) >= threshold,
    ),
    ...report.suppressedFindings.map(({ finding }) => finding),
  ];
  if (
    !report.analysisComplete &&
    hasUnexplainedIncompleteAnalysis(report, explanatoryFindings)
  ) {
    return 2;
  }
  return gatingFindings.length > 0 ? 1 : 0;
}

function hasUnexplainedIncompleteAnalysis(
  report: LintReport,
  explanatoryFindings: readonly PptxFinding[],
): boolean {
  if (
    report.diagnostics.some(
      (diagnostic) =>
        !isDiagnosticCovered(
          diagnostic,
          report.diagnostics,
          explanatoryFindings,
        ),
    )
  ) {
    return true;
  }

  const malformedFindings = report.findings.filter(
    (finding) => finding.ruleId === "package/malformed-xml",
  );
  if (
    malformedFindings.some((finding) => !explanatoryFindings.includes(finding))
  ) {
    return true;
  }

  return report.diagnostics.length === 0 && malformedFindings.length === 0;
}

function isDiagnosticCovered(
  diagnostic: ContextDiagnostic,
  diagnostics: readonly ContextDiagnostic[],
  gatingFindings: readonly PptxFinding[],
): boolean {
  if (diagnostic.code === "malformed-xml") {
    return hasMalformedXmlFinding(diagnostic.partName, gatingFindings);
  }
  if (
    diagnostic.code === "invalid-content-types" ||
    diagnostic.code === "invalid-relationships"
  ) {
    const hasPairedMalformedDiagnostic = diagnostics.some(
      (candidate) =>
        candidate.code === "malformed-xml" &&
        samePartName(candidate.partName, diagnostic.partName),
    );
    return (
      hasPairedMalformedDiagnostic &&
      hasMalformedXmlFinding(diagnostic.partName, gatingFindings)
    );
  }
  if (
    diagnostic.code === "invalid-relationship-target" ||
    diagnostic.code === "missing-presentation-part" ||
    diagnostic.code === "missing-presentation-target"
  ) {
    return gatingFindings.some(
      (finding) =>
        (finding.ruleId === "package/broken-relationship" ||
          finding.ruleId === "package/missing-media") &&
        samePartName(finding.evidence.relationshipPart, diagnostic.partName) &&
        finding.evidence.relationshipId === diagnostic.relationshipId,
    );
  }
  if (diagnostic.code === "missing-office-document") {
    return hasMalformedXmlFinding(
      relationshipsPartForSource(null),
      gatingFindings,
    );
  }
  if (
    diagnostic.code === "missing-presentation-relationship" &&
    diagnostic.partName !== null
  ) {
    return hasMalformedXmlFinding(
      relationshipsPartForSource(diagnostic.partName),
      gatingFindings,
    );
  }
  return false;
}

function hasMalformedXmlFinding(
  partName: string | null,
  gatingFindings: readonly PptxFinding[],
): boolean {
  return gatingFindings.some(
    (finding) =>
      finding.ruleId === "package/malformed-xml" &&
      samePartName(finding.location.part, partName),
  );
}

function samePartName(left: unknown, right: string | null): boolean {
  return (
    typeof left === "string" &&
    right !== null &&
    partNameComparisonKey(left) === partNameComparisonKey(right)
  );
}

async function finalizeFinding(
  file: string,
  inputKey: string,
  ruleId: RuleId,
  severity: Severity,
  draft: FindingDraft,
): Promise<PptxFinding> {
  const location = canonicalLocation(draft.location);
  return {
    ruleId,
    severity,
    status: "new",
    message: draft.message,
    file,
    location,
    evidence: canonicalEvidence(draft.evidence),
    fingerprint: await createFindingFingerprint({
      inputKey,
      ruleId,
      location,
      discriminator: draft.fingerprintDiscriminator,
    }),
  };
}

function hasPrerequisites(
  context: PptxContext,
  prerequisites: readonly ContextCapability[],
): boolean {
  return prerequisites.every(
    (capability) =>
      (capability !== "presentation" || context.presentation !== null) &&
      (capability !== "text" || context.presentation !== null),
  );
}

function canonicalLocation(location: FindingLocation): FindingLocation {
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
    ...(location.shapeNames === undefined
      ? {}
      : { shapeNames: [...location.shapeNames].sort() }),
    ...(location.paragraphIndex === undefined
      ? {}
      : { paragraphIndex: location.paragraphIndex }),
    ...(location.runIndex === undefined ? {} : { runIndex: location.runIndex }),
  };
}

function canonicalEvidence(evidence: FindingEvidence): FindingEvidence {
  return Object.fromEntries(
    Object.entries(evidence)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => [key, canonicalEvidenceValue(value)]),
  );
}

function canonicalEvidenceValue(
  value: FindingEvidence[string],
): FindingEvidence[string] {
  if (isEvidenceArray(value)) {
    const canonical = value.map((entry) => canonicalEvidenceValue(entry));
    return canonical.every(
      (entry): entry is string => typeof entry === "string",
    )
      ? canonical.sort(compareText)
      : canonical;
  }
  if (typeof value === "object" && value !== null) {
    return canonicalEvidence(value);
  }
  return value;
}

function isEvidenceArray(
  value: FindingEvidence[string],
): value is readonly FindingEvidence[string][] {
  return Array.isArray(value);
}

function deduplicateFindings(findings: readonly PptxFinding[]): PptxFinding[] {
  const unique = new Map<string, PptxFinding>();
  for (const finding of findings) unique.set(finding.fingerprint, finding);
  return [...unique.values()];
}

function compareFindings(left: PptxFinding, right: PptxFinding): number {
  return (
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.location.part ?? "", right.location.part ?? "") ||
    (left.location.slideNumber ?? 0) - (right.location.slideNumber ?? 0) ||
    compareText(left.fingerprint, right.fingerprint)
  );
}

function compareDiagnostics(
  left: LintReport["diagnostics"][number],
  right: LintReport["diagnostics"][number],
): number {
  return (
    compareText(left.partName ?? "", right.partName ?? "") ||
    compareText(left.code, right.code) ||
    compareText(left.relationshipId ?? "", right.relationshipId ?? "") ||
    compareText(left.message, right.message)
  );
}

function severityRank(severity: Severity): number {
  return severity === "error" ? 2 : 1;
}

function countSeverities(findings: readonly PptxFinding[]): SeverityCounts {
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  return {
    errors,
    warnings: findings.length - errors,
    total: findings.length,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
