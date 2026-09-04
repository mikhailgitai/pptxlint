import type {
  PptxFinding,
  RuleId,
  SuppressedFinding,
  UnusedSuppression,
} from "../lint/types.js";
import { partNameComparisonKey } from "../opc/path.js";

export interface Suppression {
  readonly rule: RuleId;
  readonly file?: string;
  readonly slide?: number;
  readonly slideId?: string;
  readonly shapeIds?: readonly number[];
  readonly part?: string;
  readonly reason?: string;
}

export interface SuppressionResult {
  readonly findings: readonly PptxFinding[];
  readonly suppressedFindings: readonly SuppressedFinding[];
  readonly unusedSuppressions: readonly UnusedSuppression[];
}

export function applySuppressions(
  findings: readonly PptxFinding[],
  inputKey: string,
  suppressions: readonly Suppression[],
): SuppressionResult {
  const unsuppressed: PptxFinding[] = [];
  const suppressedFindings: SuppressedFinding[] = [];
  const used = new Set<number>();

  for (const finding of findings) {
    const suppressionIndex = suppressions.findIndex((suppression) =>
      matchesSuppression(finding, inputKey, suppression),
    );
    if (suppressionIndex < 0) {
      unsuppressed.push(finding);
      continue;
    }

    used.add(suppressionIndex);
    const suppression = suppressions[suppressionIndex];
    if (suppression === undefined) {
      throw new TypeError("Matched suppression index is out of bounds.");
    }
    suppressedFindings.push({
      finding,
      suppressionIndex,
      ...(suppression.reason === undefined
        ? {}
        : { reason: suppression.reason }),
    });
  }

  const unusedSuppressions = suppressions.flatMap(
    (suppression, suppressionIndex): readonly UnusedSuppression[] =>
      used.has(suppressionIndex) ||
      (suppression.file !== undefined && suppression.file !== inputKey)
        ? []
        : [
            {
              suppressionIndex,
              ruleId: suppression.rule,
              ...(suppression.reason === undefined
                ? {}
                : { reason: suppression.reason }),
            },
          ],
  );

  return {
    findings: unsuppressed,
    suppressedFindings,
    unusedSuppressions,
  };
}

export function matchesSuppression(
  finding: PptxFinding,
  inputKey: string,
  suppression: Suppression,
): boolean {
  if (finding.ruleId !== suppression.rule) return false;
  if (suppression.file !== undefined && suppression.file !== inputKey) {
    return false;
  }
  if (
    suppression.slide !== undefined &&
    suppression.slide !== finding.location.slideNumber
  ) {
    return false;
  }
  if (
    suppression.slideId !== undefined &&
    suppression.slideId !== finding.location.slideId
  ) {
    return false;
  }
  if (
    suppression.part !== undefined &&
    (finding.location.part === undefined ||
      partNameComparisonKey(suppression.part) !==
        partNameComparisonKey(finding.location.part))
  ) {
    return false;
  }
  if (
    suppression.shapeIds !== undefined &&
    !sameNumbers(suppression.shapeIds, finding.location.shapeIds)
  ) {
    return false;
  }
  return true;
}

function sameNumbers(
  expected: readonly number[],
  actual: readonly number[] | undefined,
): boolean {
  return (
    expected.length === actual?.length &&
    expected.every((value, index) => value === actual[index])
  );
}
