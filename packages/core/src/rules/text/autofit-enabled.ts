import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import { validateOptionsObject } from "../layout/shared.js";
import { bodyLocation, shapeDescription } from "./shared.js";

export const autofitEnabledRule: PptxLintRule = {
  descriptor: {
    id: "text/autofit-enabled",
    defaultSeverity: "warning",
    prerequisites: ["text"],
    defaultOptions: Object.freeze({}),
    validateOptions(value): Readonly<Record<string, never>> {
      validateOptionsObject(value, []);
      return Object.freeze({});
    },
  },
  analyze(context) {
    const findings: FindingDraft[] = [];
    for (const body of context.text.bodies) {
      if (
        body.autofit.kind !== "runtime" ||
        body.autofit.persistedScaleRatio !== undefined
      ) {
        continue;
      }
      findings.push({
        message: `${shapeDescription(body)} has runtime autofit enabled without a usable persisted fontScale; the final text size depends on installed font metrics and the rendering engine.`,
        location: bodyLocation(body),
        evidence: {
          autofitKind: body.autofit.kind,
          rawFontScale: body.autofit.rawFontScale ?? null,
          reason:
            body.autofit.unusableScaleReason ??
            "No usable persisted fontScale is available.",
          sourceKind: body.autofit.sourceKind,
          sourcePart: body.autofit.sourcePart,
          textBodyIndex: body.textBodyIndex,
        },
        fingerprintDiscriminator: `${String(body.shapeId)}\0${String(body.textBodyIndex)}`,
      });
    }
    return Promise.resolve(findings);
  },
};
