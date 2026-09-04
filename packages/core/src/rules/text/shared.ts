import type { FindingEvidence, FindingLocation } from "../../lint/types.js";
import type {
  PlaceholderKind,
  ResolvedTextBody,
  ResolvedTextRun,
  ResolvedValue,
} from "../../text/types.js";
import { finiteNumberOption, validateOptionsObject } from "../layout/shared.js";

export interface MinimumFontOptions {
  readonly defaultPt: number;
  readonly titlePt: number;
}

export const DEFAULT_MINIMUM_FONT_OPTIONS: MinimumFontOptions = Object.freeze({
  defaultPt: 12,
  titlePt: 20,
});

export function validateMinimumFontOptions(value: unknown): MinimumFontOptions {
  const options = validateOptionsObject(value, ["defaultPt", "titlePt"]);
  return {
    defaultPt: finiteNumberOption(
      options,
      "defaultPt",
      DEFAULT_MINIMUM_FONT_OPTIONS.defaultPt,
      1,
      4_000,
    ),
    titlePt: finiteNumberOption(
      options,
      "titlePt",
      DEFAULT_MINIMUM_FONT_OPTIONS.titlePt,
      1,
      4_000,
    ),
  };
}

export function minimumFor(
  placeholderKind: PlaceholderKind,
  options: MinimumFontOptions,
): number {
  return placeholderKind === "title" ? options.titlePt : options.defaultPt;
}

export function runLocation(
  body: ResolvedTextBody,
  run: ResolvedTextRun,
): FindingLocation {
  return {
    part: body.partName,
    slideNumber: body.slideNumber,
    slideId: body.slideId,
    shapeIds: [body.shapeId],
    ...(body.shapeName === null ? {} : { shapeNames: [body.shapeName] }),
    paragraphIndex: run.paragraphIndex,
    runIndex: run.runIndex,
  };
}

export function bodyLocation(body: ResolvedTextBody): FindingLocation {
  return {
    part: body.partName,
    slideNumber: body.slideNumber,
    slideId: body.slideId,
    shapeIds: [body.shapeId],
    ...(body.shapeName === null ? {} : { shapeNames: [body.shapeName] }),
  };
}

export function resolvedValueEvidence<T extends number | string>(
  value: Extract<ResolvedValue<T>, { readonly status: "resolved" }>,
): FindingEvidence {
  return {
    sourcePart: value.sourcePart,
    sourceKind: value.sourceKind,
    ...(value.rawValue === undefined ? {} : { rawValue: value.rawValue }),
    ...(value.referencePart === undefined
      ? {}
      : { referencePart: value.referencePart }),
    ...(value.referenceKind === undefined
      ? {}
      : { referenceKind: value.referenceKind }),
  };
}

export function stablePointSize(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function runDiscriminator(
  body: ResolvedTextBody,
  run: ResolvedTextRun,
): string {
  return `${String(body.shapeId)}\0${String(body.textBodyIndex)}\0${String(run.paragraphIndex)}\0${String(run.runIndex)}`;
}

export function shapeDescription(body: ResolvedTextBody): string {
  return body.shapeName === null
    ? `Shape ${String(body.shapeId)}`
    : JSON.stringify(body.shapeName);
}
