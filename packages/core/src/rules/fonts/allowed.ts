import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import type { Severity } from "../../lint/types.js";
import type { TextScriptSlot } from "../../text/types.js";
import { validateOptionsObject } from "../layout/shared.js";
import {
  resolvedValueEvidence,
  runDiscriminator,
  runLocation,
  shapeDescription,
} from "../text/shared.js";

export interface AllowedFontsOptions {
  readonly families: readonly string[];
  readonly unresolved: "ignore" | Severity;
}

const DEFAULT_OPTIONS: AllowedFontsOptions = Object.freeze({
  families: Object.freeze([]),
  unresolved: "ignore",
});

export const allowedFontsRule: PptxLintRule = {
  descriptor: {
    id: "fonts/allowed",
    defaultSeverity: "off",
    prerequisites: ["text"],
    defaultOptions: DEFAULT_OPTIONS,
    validateOptions(value): AllowedFontsOptions {
      const options = validateOptionsObject(value, ["families", "unresolved"]);
      if (!Array.isArray(options.families) || options.families.length === 0) {
        throw new TypeError(
          "families must be a non-empty array of font names.",
        );
      }
      const families = options.families.map((family) => {
        if (typeof family !== "string" || family.trim() === "") {
          throw new TypeError("families must contain non-empty font names.");
        }
        return family.trim();
      });
      const normalized = families.map(normalizeFamily);
      if (new Set(normalized).size !== normalized.length) {
        throw new TypeError("families must not contain duplicate font names.");
      }
      const unresolved = options.unresolved ?? DEFAULT_OPTIONS.unresolved;
      if (
        unresolved !== "ignore" &&
        unresolved !== "warning" &&
        unresolved !== "error"
      ) {
        throw new TypeError(
          'unresolved must be "ignore", "warning", or "error".',
        );
      }
      return { families, unresolved };
    },
  },
  analyze(context, value) {
    const options = value as AllowedFontsOptions;
    const allowed = new Set(options.families.map(normalizeFamily));
    const findings: FindingDraft[] = [];
    for (const body of context.text.bodies) {
      for (const run of body.runs) {
        for (const slot of run.usedScriptSlots) {
          const typeface = run.style.typeface[slot];
          if (typeface.status === "unresolved") {
            if (options.unresolved === "ignore") continue;
            findings.push({
              severity: options.unresolved,
              message: `${shapeDescription(body)} has an unresolved ${slotLabel(slot)} typeface; the configured font allowlist cannot be evaluated for this run.`,
              location: runLocation(body, run),
              evidence: {
                allowedFamilies: options.families,
                placeholderKind: body.placeholderKind,
                reason: typeface.reason,
                scriptSlot: slot,
                ...(typeface.sourcePart === undefined
                  ? {}
                  : { sourcePart: typeface.sourcePart }),
                ...(typeface.sourceKind === undefined
                  ? {}
                  : { sourceKind: typeface.sourceKind }),
                ...(typeface.rawValue === undefined
                  ? {}
                  : { rawTypeface: typeface.rawValue }),
                textBodyIndex: body.textBodyIndex,
              },
              fingerprintDiscriminator: `${runDiscriminator(body, run)}\0${slot}\0unresolved`,
            });
            continue;
          }
          if (allowed.has(normalizeFamily(typeface.value))) continue;
          findings.push({
            message: `${shapeDescription(body)} uses ${JSON.stringify(typeface.value)} for the ${slotLabel(slot)} script slot, which is not in the configured font allowlist.`,
            location: runLocation(body, run),
            evidence: {
              allowedFamilies: options.families,
              fontProvenance: resolvedValueEvidence(typeface),
              placeholderKind: body.placeholderKind,
              resolvedTypeface: typeface.value,
              scriptSlot: slot,
              textBodyIndex: body.textBodyIndex,
            },
            fingerprintDiscriminator: `${runDiscriminator(body, run)}\0${slot}`,
          });
        }
      }
    }
    return Promise.resolve(findings);
  },
};

function normalizeFamily(value: string): string {
  return value.trim().toLowerCase();
}

function slotLabel(slot: TextScriptSlot): string {
  return slot === "eastAsian"
    ? "East Asian"
    : slot === "complexScript"
      ? "Complex Script"
      : "Latin";
}
