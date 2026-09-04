import type { Point } from "../../geometry/affine.js";
import type { Rectangle } from "../../geometry/polygon.js";
import type {
  FindingEvidence,
  FindingEvidenceValue,
} from "../../lint/types.js";

export const EMU_PER_POINT = 12_700;

export function validateOptionsObject(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("options must be an object.");
  }
  const options = value as Readonly<Record<string, unknown>>;
  const unknown = Object.keys(options)
    .sort()
    .find((key) => !allowedKeys.includes(key));
  if (unknown !== undefined) {
    throw new TypeError(`unknown option ${JSON.stringify(unknown)}.`);
  }
  return options;
}

export function finiteNumberOption(
  options: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = options[name] === undefined ? fallback : options[name];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${name} must be a finite number between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value;
}

export function rectangleEvidence(rectangle: Rectangle): FindingEvidence {
  return {
    x: stableEmu(rectangle.x),
    y: stableEmu(rectangle.y),
    width: stableEmu(rectangle.width),
    height: stableEmu(rectangle.height),
  };
}

export function rectanglePointEvidence(rectangle: Rectangle): FindingEvidence {
  return {
    x: stablePoints(rectangle.x),
    y: stablePoints(rectangle.y),
    width: stablePoints(rectangle.width),
    height: stablePoints(rectangle.height),
  };
}

export function polygonEvidence(
  polygon: readonly Point[],
): readonly FindingEvidenceValue[] {
  return polygon.map((point) => ({
    x: stableEmu(point.x),
    y: stableEmu(point.y),
  }));
}

export function stableEmu(value: number): number {
  return round(value, 3);
}

export function stablePoints(value: number): number {
  return round(value / EMU_PER_POINT, 3);
}

export function stableRatio(value: number): number {
  return round(value, 6);
}

export function stableArea(value: number): number {
  return round(value, 3);
}

export function percentage(value: number): string {
  const rounded = round(value * 100, 1);
  return `${String(rounded)}%`;
}

function round(value: number, fractionDigits: number): number {
  const multiplier = 10 ** fractionDigits;
  const rounded = Math.round(value * multiplier) / multiplier;
  return Object.is(rounded, -0) ? 0 : rounded;
}
