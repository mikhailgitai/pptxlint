import { inspectRasterOpacity } from "../../geometry/opacity.js";
import type { OpacityEvidence } from "../../geometry/opacity.js";
import {
  intersectConvexPolygons,
  polygonArea,
  polygonBounds,
} from "../../geometry/polygon.js";
import type {
  ShapeGeometry,
  TextFrameGeometry,
} from "../../geometry/shape-geometry.js";
import type { PptxContext } from "../../context/types.js";
import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import { isRelationshipType } from "../../relationships/relationships.js";
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

export interface TextOccludedOptions {
  readonly minOccludedRatio: number;
}

const DEFAULT_OPTIONS: TextOccludedOptions = Object.freeze({
  minOccludedRatio: 0.2,
});

export const textOccludedRule: PptxLintRule = {
  descriptor: {
    id: "layout/text-occluded",
    defaultSeverity: "off",
    prerequisites: ["presentation", "relationships", "archive"],
    defaultOptions: DEFAULT_OPTIONS,
    validateOptions(value): TextOccludedOptions {
      const options = validateOptionsObject(value, ["minOccludedRatio"]);
      return {
        minOccludedRatio: finiteNumberOption(
          options,
          "minOccludedRatio",
          DEFAULT_OPTIONS.minOccludedRatio,
          0,
          1,
        ),
      };
    },
  },
  async analyze(context, value) {
    const options = value as TextOccludedOptions;
    const findings: FindingDraft[] = [];
    for (const slide of context.presentation?.slides ?? []) {
      if (!slide.available || slide.partName === null) continue;
      const opacityByShape = new Map<
        ShapeGeometry,
        Promise<ResolvedOpacityEvidence>
      >();
      const shapes = slide.geometry.shapes;
      for (const textShape of shapes.filter((shape) => shape.hasVisibleText)) {
        for (const foreground of shapes) {
          if (
            foreground.shapeId === textShape.shapeId ||
            foreground.zIndex <= textShape.zIndex
          ) {
            continue;
          }
          const coverage = maximumTextFrameCoverage(textShape, foreground);
          if (
            coverage === null ||
            coverage.ratio + Number.EPSILON < options.minOccludedRatio
          ) {
            continue;
          }

          let opacity = opacityByShape.get(foreground);
          if (opacity === undefined) {
            opacity = resolveOpacity(context, slide.partName, foreground);
            opacityByShape.set(foreground, opacity);
          }
          const resolvedOpacity = await opacity;
          if (resolvedOpacity.state !== "opaque") continue;

          findings.push({
            message: `Opaque foreground shape covers ${percentage(coverage.ratio)} of the transformed text frame. This is text-frame geometry, not pixel-perfect rendered glyph coverage.`,
            location: {
              part: slide.partName,
              slideNumber: slide.number,
              slideId: slide.persistentId,
              shapeIds: [textShape.shapeId, foreground.shapeId],
              ...(textShape.shapeName === null && foreground.shapeName === null
                ? {}
                : {
                    shapeNames: [
                      textShape.shapeName,
                      foreground.shapeName,
                    ].filter((name): name is string => name !== null),
                  }),
            },
            evidence: {
              foregroundBoundsEmu: rectangleEvidence(foreground.bounds),
              foregroundBoundsPt: rectanglePointEvidence(foreground.bounds),
              foregroundShapeId: foreground.shapeId,
              foregroundShapeName: foreground.shapeName,
              foregroundZIndex: foreground.zIndex,
              intersectionAreaEmu2: stableArea(coverage.area),
              intersectionBoundsEmu: rectangleEvidence(coverage.bounds),
              intersectionPolygonEmu: polygonEvidence(coverage.polygon),
              minOccludedRatio: options.minOccludedRatio,
              occludedRatio: stableRatio(coverage.ratio),
              opacityBasis: resolvedOpacity.basis,
              opacityState: resolvedOpacity.state,
              ...(resolvedOpacity.alpha === undefined
                ? {}
                : { opacityAlpha: stableRatio(resolvedOpacity.alpha) }),
              ...(resolvedOpacity.imageRelationshipId === undefined
                ? {}
                : {
                    imageRelationshipId: resolvedOpacity.imageRelationshipId,
                  }),
              ...(resolvedOpacity.mediaPart === undefined
                ? {}
                : { mediaPart: resolvedOpacity.mediaPart }),
              textBoundsEmu: rectangleEvidence(coverage.textFrame.bounds),
              textBoundsPt: rectanglePointEvidence(coverage.textFrame.bounds),
              textFrame: coverage.textFrame.key,
              textFrameAreaEmu2: stableArea(coverage.textFrameArea),
              textShapeId: textShape.shapeId,
              textShapeName: textShape.shapeName,
              textZIndex: textShape.zIndex,
            },
            fingerprintDiscriminator: `${String(textShape.shapeId)}\0${String(foreground.shapeId)}\0${coverage.textFrame.key}`,
          });
        }
      }
    }
    return findings;
  },
};

interface TextFrameCoverage {
  readonly textFrame: TextFrameGeometry;
  readonly textFrameArea: number;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly bounds: NonNullable<ReturnType<typeof polygonBounds>>;
  readonly area: number;
  readonly ratio: number;
}

interface ResolvedOpacityEvidence extends OpacityEvidence {
  readonly mediaPart?: string;
}

function maximumTextFrameCoverage(
  textShape: ShapeGeometry,
  foreground: ShapeGeometry,
): TextFrameCoverage | null {
  let maximum: TextFrameCoverage | null = null;
  for (const textFrame of textShape.textFrames) {
    const textFrameArea = polygonArea(textFrame.polygon);
    if (textFrameArea <= 0) continue;
    const polygon = intersectConvexPolygons(
      textFrame.polygon,
      foreground.polygon,
    );
    const area = polygonArea(polygon);
    if (area <= 0) continue;
    const bounds = polygonBounds(polygon);
    if (bounds === null) continue;
    const ratio = area / textFrameArea;
    if (maximum === null || ratio > maximum.ratio) {
      maximum = { textFrame, textFrameArea, polygon, bounds, area, ratio };
    }
  }
  return maximum;
}

async function resolveOpacity(
  context: PptxContext,
  slidePart: string,
  shape: ShapeGeometry,
): Promise<ResolvedOpacityEvidence> {
  if (
    shape.opacity.state !== "unknown" ||
    shape.opacity.basis !== "embedded-image"
  ) {
    return shape.opacity;
  }

  const relationshipId = shape.opacity.imageRelationshipId;
  const relationship =
    relationshipId === undefined
      ? undefined
      : context.relationships.getById(slidePart, relationshipId);
  if (
    relationshipId === undefined ||
    relationship?.targetMode !== "internal" ||
    !isRelationshipType(relationship.type, "image") ||
    relationship.resolvedTarget === null ||
    relationship.targetExists !== true
  ) {
    return {
      state: "unknown",
      basis: "image-reference-unresolved",
      ...(relationshipId === undefined
        ? {}
        : { imageRelationshipId: relationshipId }),
    };
  }

  const read = await context.archive.read(relationship.resolvedTarget);
  if (!read.ok) {
    return {
      state: "unknown",
      basis: "media-unreadable",
      imageRelationshipId: relationshipId,
      mediaPart: relationship.resolvedTarget,
    };
  }
  return {
    ...inspectRasterOpacity(read.bytes),
    imageRelationshipId: relationshipId,
    mediaPart: relationship.resolvedTarget,
  };
}
