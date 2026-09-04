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

export type MinFontSizeOptions = MinimumFontOptions;

export const minFontSizeRule: PptxLintRule = {
  descriptor: {
    id: "text/min-font-size",
    defaultSeverity: "error",
    prerequisites: ["text"],
    defaultOptions: DEFAULT_MINIMUM_FONT_OPTIONS,
    validateOptions: validateMinimumFontOptions,
  },
  analyze(context, value) {
    const options = value as MinFontSizeOptions;
    const findings: FindingDraft[] = [];
    for (const body of context.text.bodies) {
      for (const run of body.runs) {
        const base = run.style.baseFontSizePt;
        if (base.status !== "resolved") continue;
        if (
          body.autofit.kind === "runtime" &&
          body.autofit.persistedScaleRatio !== undefined
        ) {
          continue;
        }
        const minimum = minimumFor(body.placeholderKind, options);
        if (base.value + Number.EPSILON >= minimum) continue;
        const size = stablePointSize(base.value);
        findings.push({
          message: `${shapeDescription(body)} uses ${String(size)}pt text; the configured ${body.placeholderKind === "title" ? "title" : "default"} minimum is ${String(minimum)}pt.`,
          location: runLocation(body, run),
          evidence: {
            baseFontSizePt: size,
            configuredMinimumPt: minimum,
            placeholderKind: body.placeholderKind,
            sizeProvenance: resolvedValueEvidence(base),
            textBodyIndex: body.textBodyIndex,
          },
          fingerprintDiscriminator: runDiscriminator(body, run),
        });
      }
    }
    return Promise.resolve(findings);
  },
};
