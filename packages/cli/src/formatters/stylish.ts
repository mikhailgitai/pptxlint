import type { FindingLocation, LintReport } from "@pptxlint/core";

import type { CommandReport } from "../report.js";

export function formatStylish(report: CommandReport): string {
  return report.inputs.map(formatInput).join("");
}

function formatInput(report: LintReport): string {
  const newFindings = report.findings.filter(
    (finding) => finding.status === "new",
  );
  if (
    newFindings.length === 0 &&
    report.summary.existing.total === 0 &&
    report.summary.resolved === 0 &&
    report.summary.suppressed === 0 &&
    report.unusedSuppressions.length === 0
  ) {
    return "";
  }

  const lines = [report.input.file, ""];
  for (const finding of newFindings) {
    lines.push(
      `  ${formatLocation(finding.location)}`,
      `  ${finding.severity.padEnd(7)} ${finding.ruleId}`,
      `  ${finding.message}`,
      "",
    );
  }
  const { errors, total, warnings } = report.summary.new;
  lines.push(
    total === 0
      ? "✔ No new problems"
      : `✖ ${String(total)} new ${total === 1 ? "problem" : "problems"} (${String(errors)} ${errors === 1 ? "error" : "errors"}, ${String(warnings)} ${warnings === 1 ? "warning" : "warnings"})`,
  );
  const metadata = statusMetadata(report);
  if (metadata.length > 0) lines.push(`  ${metadata.join(" · ")}`);

  const usedReasons = new Map<number, string>();
  for (const suppressed of report.suppressedFindings) {
    if (suppressed.reason !== undefined) {
      usedReasons.set(suppressed.suppressionIndex, suppressed.reason);
    }
  }
  for (const [index, reason] of usedReasons) {
    lines.push(`  suppression ignore[${String(index)}]: ${reason}`);
  }
  for (const unused of report.unusedSuppressions) {
    lines.push(
      `  unused suppression ignore[${String(unused.suppressionIndex)}] (${unused.ruleId})${unused.reason === undefined ? "" : `: ${unused.reason}`}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function statusMetadata(report: LintReport): readonly string[] {
  const metadata: string[] = [];
  if (report.summary.existing.total > 0) {
    metadata.push(`${String(report.summary.existing.total)} existing`);
  }
  if (report.summary.resolved > 0) {
    metadata.push(`${String(report.summary.resolved)} resolved`);
  }
  if (report.summary.suppressed > 0) {
    metadata.push(`${String(report.summary.suppressed)} suppressed`);
  }
  if (report.unusedSuppressions.length > 0) {
    metadata.push(
      `${String(report.unusedSuppressions.length)} unused ${report.unusedSuppressions.length === 1 ? "suppression" : "suppressions"}`,
    );
  }
  return metadata;
}

function formatLocation(location: FindingLocation): string {
  const segments: string[] = [];
  if (location.slideNumber !== undefined) {
    segments.push(`slide ${String(location.slideNumber)}`);
  }
  if (location.shapeIds !== undefined && location.shapeIds.length > 0) {
    segments.push(
      `${location.shapeIds.length === 1 ? "shape" : "shapes"} ${location.shapeIds.join(", ")}`,
    );
  }
  if (segments.length === 0 && location.part !== undefined) {
    segments.push(`part ${location.part}`);
  }
  return segments.length === 0 ? "package" : segments.join(" / ");
}
