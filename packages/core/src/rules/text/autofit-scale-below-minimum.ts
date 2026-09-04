import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import {
  DEFAULT_MINIMUM_FONT_OPTIONS,
  minimumFor,
  resolvedValueEvidence,
  runDiscriminator,
  runLocation,
  shapeDescription,
  stablePointSize,
  validateMinimumFontOptions,
} from "./shared.js";
import type { MinimumFontOptions } from "./shared.js";

export type AutofitScaleBelowMinimumOptions = MinimumFontOptions;

export const autofitScaleBelowMinimumRule: PptxLintRule = {
  descriptor: {
    id: "text/autofit-scale-below-minimum",
    defaultSeverity: "error",
    prerequisites: ["text"],
    defaultOptions: DEFAULT_MINIMUM_FONT_OPTIONS,
    validateOptions: validateMinimumFontOptions,
  },
  analyze(context, value) {
    const options = value as AutofitScaleBelowMinimumOptions;
    const findings: FindingDraft[] = [];
    for (const body of context.text.bodies) {
      if (
        body.autofit.kind !== "runtime" ||
        body.autofit.persistedScaleRatio === undefined
      ) {
        continue;
      }
      for (const run of body.runs) {
        const base = run.style.baseFontSizePt;
        const effective = run.style.fontSizePt;
        if (base.status !== "resolved" || effective.status !== "resolved") {
          continue;
        }
        const minimum = minimumFor(body.placeholderKind, options);
        if (effective.value + Number.EPSILON >= minimum) continue;
        const baseSize = stablePointSize(base.value);
        const effectiveSize = stablePointSize(effective.value);
        findings.push({
          message: `Stored fontScale reduces ${shapeDescription(body)} text from ${String(baseSize)}pt to ${String(effectiveSize)}pt; the configured minimum is ${String(minimum)}pt.`,
          location: runLocation(body, run),
          evidence: {
            baseFontSizePt: baseSize,
            baseSizeProvenance: resolvedValueEvidence(base),
            configuredMinimumPt: minimum,
            effectiveFontSizePt: effectiveSize,
            fontScaleRatio: body.autofit.persistedScaleRatio,
            placeholderKind: body.placeholderKind,
            rawFontScale: body.autofit.rawFontScale ?? null,
            scaleSourceKind: body.autofit.sourceKind,
            scaleSourcePart: body.autofit.sourcePart,
            textBodyIndex: body.textBodyIndex,
          },
          fingerprintDiscriminator: runDiscriminator(body, run),
        });
      }
    }
    return Promise.resolve(findings);
  },
};
