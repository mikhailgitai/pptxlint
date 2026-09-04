import {
  intersectConvexPolygons,
  polygonArea,
  polygonBounds,
} from "../../geometry/polygon.js";
import type {
  ShapeGeometry,
  TextFrameGeometry,
} from "../../geometry/shape-geometry.js";
import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import {
  finiteNumberOption,
  percentage,
  polygonEvidence,
  rectangleEvidence,
  rectanglePointEvidence,
  stableArea,
  stableRatio,
  validateOptionsObject,
} from "./shared.js";

export interface TextOverlapOptions {
  readonly minOverlapRatio: number;
}

const DEFAULT_OPTIONS: TextOverlapOptions = Object.freeze({
  minOverlapRatio: 0.2,
});

export const textOverlapRule: PptxLintRule = {
  descriptor: {
    id: "layout/text-overlap",
    defaultSeverity: "warning",
    prerequisites: ["presentation"],
    defaultOptions: DEFAULT_OPTIONS,
    validateOptions(value): TextOverlapOptions {
      const options = validateOptionsObject(value, ["minOverlapRatio"]);
      return {
        minOverlapRatio: finiteNumberOption(
          options,
          "minOverlapRatio",
          DEFAULT_OPTIONS.minOverlapRatio,
          0,
          1,
        ),
      };
    },
  },
  analyze(context, value) {
    const options = value as TextOverlapOptions;
    const findings: FindingDraft[] = [];
    for (const slide of context.presentation?.slides ?? []) {
      if (!slide.available || slide.partName === null) continue;
      const shapes = slide.geometry.shapes.filter(
        (shape) => shape.hasVisibleText,
      );
      for (const [index, candidate] of shapes.entries()) {
        for (const other of shapes.slice(index + 1)) {
          if (!independentObjects(candidate, other)) continue;
          const [first, second] = canonicalPair(candidate, other);
          const overlap = maximumTextFrameOverlap(first, second);
          if (
            overlap === null ||
            overlap.ratio + Number.EPSILON < options.minOverlapRatio
          ) {
            continue;
          }

          findings.push({
            message: `Text frames overlap by ${percentage(overlap.ratio)} of the smaller transformed frame. This is frame geometry, not a rendered glyph collision.`,
            location: {
              part: slide.partName,
              slideNumber: slide.number,
              slideId: slide.persistentId,
              shapeIds: [first.shapeId, second.shapeId],
              ...(first.shapeName === null && second.shapeName === null
                ? {}
                : {
                    shapeNames: [first.shapeName, second.shapeName].filter(
                      (name): name is string => name !== null,
                    ),
                  }),
            },
            evidence: {
              firstBoundsEmu: rectangleEvidence(overlap.first.bounds),
              firstBoundsPt: rectanglePointEvidence(overlap.first.bounds),
              firstShapeId: first.shapeId,
              firstShapeName: first.shapeName,
              firstTextFrame: overlap.first.key,
              intersectionAreaEmu2: stableArea(overlap.area),
              intersectionBoundsEmu: rectangleEvidence(overlap.bounds),
              intersectionPolygonEmu: polygonEvidence(overlap.polygon),
              minOverlapRatio: options.minOverlapRatio,
              overlapRatio: stableRatio(overlap.ratio),
              secondBoundsEmu: rectangleEvidence(overlap.second.bounds),
              secondBoundsPt: rectanglePointEvidence(overlap.second.bounds),
              secondShapeId: second.shapeId,
              secondShapeName: second.shapeName,
              secondTextFrame: overlap.second.key,
              smallerShapeId:
                overlap.firstArea <= overlap.secondArea
                  ? first.shapeId
                  : second.shapeId,
            },
            fingerprintDiscriminator: `${String(first.shapeId)}\0${String(second.shapeId)}`,
          });
        }
      }
    }
    return Promise.resolve(findings);
  },
};

interface TextFrameOverlap {
  readonly first: TextFrameGeometry;
  readonly second: TextFrameGeometry;
  readonly firstArea: number;
  readonly secondArea: number;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly bounds: NonNullable<ReturnType<typeof polygonBounds>>;
  readonly area: number;
  readonly ratio: number;
}

function maximumTextFrameOverlap(
  first: ShapeGeometry,
  second: ShapeGeometry,
): TextFrameOverlap | null {
  let maximum: TextFrameOverlap | null = null;
  for (const firstFrame of first.textFrames) {
    const firstArea = polygonArea(firstFrame.polygon);
    if (firstArea <= 0) continue;
    for (const secondFrame of second.textFrames) {
      const secondArea = polygonArea(secondFrame.polygon);
      if (secondArea <= 0) continue;
      const polygon = intersectConvexPolygons(
        firstFrame.polygon,
        secondFrame.polygon,
      );
      const area = polygonArea(polygon);
      if (area <= 0) continue;
      const bounds = polygonBounds(polygon);
      if (bounds === null) continue;
      const ratio = area / Math.min(firstArea, secondArea);
      if (maximum === null || ratio > maximum.ratio) {
        maximum = {
          first: firstFrame,
          second: secondFrame,
          firstArea,
          secondArea,
          polygon,
          bounds,
          area,
          ratio,
        };
      }
    }
  }
  return maximum;
}

export function canonicalPair(
  first: ShapeGeometry,
  second: ShapeGeometry,
): readonly [ShapeGeometry, ShapeGeometry] {
  return first.shapeId <= second.shapeId ? [first, second] : [second, first];
}

function independentObjects(
  first: ShapeGeometry,
  second: ShapeGeometry,
): boolean {
  return (
    first.shapeId !== second.shapeId &&
    !first.parentShapeIds.includes(second.shapeId) &&
    !second.parentShapeIds.includes(first.shapeId)
  );
}
