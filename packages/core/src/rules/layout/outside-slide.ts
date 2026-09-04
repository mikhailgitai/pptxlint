import { clipPolygonToRectangle, polygonArea } from "../../geometry/polygon.js";
import type { ShapeGeometry } from "../../geometry/shape-geometry.js";
import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import {
  EMU_PER_POINT,
  finiteNumberOption,
  percentage,
  polygonEvidence,
  rectangleEvidence,
  rectanglePointEvidence,
  stableArea,
  stableEmu,
  stablePoints,
  stableRatio,
  validateOptionsObject,
} from "./shared.js";

export interface OutsideSlideOptions {
  readonly tolerancePt: number;
  readonly minOutsideRatio: number;
}

const DEFAULT_OPTIONS: OutsideSlideOptions = Object.freeze({
  tolerancePt: 2,
  minOutsideRatio: 0.05,
});

export const outsideSlideRule: PptxLintRule = {
  descriptor: {
    id: "layout/outside-slide",
    defaultSeverity: "warning",
    prerequisites: ["presentation"],
    defaultOptions: DEFAULT_OPTIONS,
    validateOptions(value): OutsideSlideOptions {
      const options = validateOptionsObject(value, [
        "minOutsideRatio",
        "tolerancePt",
      ]);
      return {
        tolerancePt: finiteNumberOption(
          options,
          "tolerancePt",
          DEFAULT_OPTIONS.tolerancePt,
          0,
          10_000,
        ),
        minOutsideRatio: finiteNumberOption(
          options,
          "minOutsideRatio",
          DEFAULT_OPTIONS.minOutsideRatio,
          0,
          1,
        ),
      };
    },
  },
  analyze(context, value) {
    const options = value as OutsideSlideOptions;
    const presentation = context.presentation;
    if (presentation?.widthEmu == null || presentation.heightEmu === null) {
      return Promise.resolve([]);
    }
    const slideRectangle = {
      x: 0,
      y: 0,
      width: presentation.widthEmu,
      height: presentation.heightEmu,
    };
    const toleranceEmu = options.tolerancePt * EMU_PER_POINT;
    const findings: FindingDraft[] = [];

    for (const slide of presentation.slides) {
      if (!slide.available || slide.partName === null) continue;
      for (const shape of slide.geometry.shapes) {
        const affectedEdges = edgesBeyondTolerance(
          shape,
          presentation.widthEmu,
          presentation.heightEmu,
          toleranceEmu,
        );
        if (affectedEdges.length === 0) continue;
        const shapeArea = polygonArea(shape.polygon);
        if (shapeArea <= 0) continue;
        const intersection = clipPolygonToRectangle(
          shape.polygon,
          slideRectangle,
        );
        const intersectionArea = Math.min(shapeArea, polygonArea(intersection));
        const outsideArea = Math.max(0, shapeArea - intersectionArea);
        const outsideRatio = outsideArea / shapeArea;
        if (outsideRatio + Number.EPSILON < options.minOutsideRatio) continue;

        const maximumOverflowEmu = maximumOverflow(
          shape,
          presentation.widthEmu,
          presentation.heightEmu,
        );
        const shapeDescription =
          shape.shapeName === null
            ? `Shape ${String(shape.shapeId)}`
            : JSON.stringify(shape.shapeName);
        findings.push({
          message: `${shapeDescription} extends ${String(stablePoints(maximumOverflowEmu))}pt beyond the ${affectedEdges.join("/")} slide edge${affectedEdges.length === 1 ? "" : "s"}; ${percentage(outsideRatio)} of its transformed area is outside.`,
          location: {
            part: slide.partName,
            slideNumber: slide.number,
            slideId: slide.persistentId,
            shapeIds: [shape.shapeId],
            ...(shape.shapeName === null
              ? {}
              : { shapeNames: [shape.shapeName] }),
          },
          evidence: {
            affectedEdges,
            boundsEmu: rectangleEvidence(shape.bounds),
            boundsPt: rectanglePointEvidence(shape.bounds),
            intersectionAreaEmu2: stableArea(intersectionArea),
            intersectionPolygonEmu: polygonEvidence(intersection),
            minOutsideRatio: options.minOutsideRatio,
            outsideAreaEmu2: stableArea(outsideArea),
            outsideRatio: stableRatio(outsideRatio),
            shapeId: shape.shapeId,
            shapeName: shape.shapeName,
            slideBoundsEmu: rectangleEvidence(slideRectangle),
            toleranceEmu: stableEmu(toleranceEmu),
            tolerancePt: options.tolerancePt,
          },
          fingerprintDiscriminator: String(shape.shapeId),
        });
      }
    }
    return Promise.resolve(findings);
  },
};

function edgesBeyondTolerance(
  shape: ShapeGeometry,
  slideWidth: number,
  slideHeight: number,
  tolerance: number,
): readonly string[] {
  const edges: string[] = [];
  if (shape.bounds.x < -tolerance) edges.push("left");
  if (shape.bounds.y < -tolerance) edges.push("top");
  if (shape.bounds.x + shape.bounds.width > slideWidth + tolerance) {
    edges.push("right");
  }
  if (shape.bounds.y + shape.bounds.height > slideHeight + tolerance) {
    edges.push("bottom");
  }
  return edges;
}

function maximumOverflow(
  shape: ShapeGeometry,
  slideWidth: number,
  slideHeight: number,
): number {
  return Math.max(
    0,
    -shape.bounds.x,
    -shape.bounds.y,
    shape.bounds.x + shape.bounds.width - slideWidth,
    shape.bounds.y + shape.bounds.height - slideHeight,
  );
}
