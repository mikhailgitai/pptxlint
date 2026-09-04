import {
  composeMatrices,
  IDENTITY_MATRIX,
  rotationMatrix,
  scaleMatrix,
  transformPoints,
  translationMatrix,
} from "./affine.js";
import type { AffineMatrix, Point } from "./affine.js";
import { polygonBounds, rectanglePolygon } from "./polygon.js";
import type { Rectangle } from "./polygon.js";
import type { OpacityEvidence } from "./opacity.js";
import type { LocalShapeKind } from "../presentation/presentation.js";
import {
  DRAWINGML_NAMESPACE,
  OFFICE_RELATIONSHIPS_NAMESPACE,
  PRESENTATIONML_NAMESPACE,
  STRICT_DRAWINGML_NAMESPACE,
  STRICT_OFFICE_RELATIONSHIPS_NAMESPACE,
  STRICT_PRESENTATIONML_NAMESPACE,
} from "../presentation/presentation.js";
import { childElements, findDescendants, getAttribute } from "../xml/query.js";
import type { XmlElement, XmlNode } from "../xml/types.js";

export interface ShapeGeometry {
  readonly shapeId: number;
  readonly shapeName: string | null;
  readonly kind: Exclude<LocalShapeKind, "group">;
  /** Flattened back-to-front order used by z-order-aware layout rules. */
  readonly zIndex: number;
  readonly parentShapeIds: readonly number[];
  readonly polygon: readonly Point[];
  readonly bounds: Rectangle;
  readonly opacity: OpacityEvidence;
  readonly textFrames: readonly TextFrameGeometry[];
  readonly hasVisibleText: boolean;
  readonly isTable: boolean;
}

export interface TextFrameGeometry {
  /** Stable within one shape; table cells use their row/column origin. */
  readonly key: string;
  readonly polygon: readonly Point[];
  readonly bounds: Rectangle;
}

export interface UnsupportedShapeGeometry {
  readonly shapeId: number | null;
  readonly shapeName: string | null;
  readonly reason: string;
}

export interface SlideGeometry {
  readonly shapes: readonly ShapeGeometry[];
  readonly unsupported: readonly UnsupportedShapeGeometry[];
}

export interface SlideGeometryInheritance {
  readonly layout?: XmlElement;
  readonly master?: XmlElement;
}

interface Transform2D {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotationDegrees: number;
  readonly flipHorizontal: boolean;
  readonly flipVertical: boolean;
}

interface GroupTransform extends Transform2D {
  readonly childX: number;
  readonly childY: number;
  readonly childWidth: number;
  readonly childHeight: number;
}

interface ShapeMetadata {
  readonly id: number | null;
  readonly name: string | null;
  readonly hidden: boolean | null;
}

interface ResolvedShapeTransform {
  readonly transform: Transform2D;
  readonly matrix: AffineMatrix;
}

interface PlaceholderIdentity {
  readonly index: string;
  readonly type: string;
}

interface PlaceholderDefinition extends PlaceholderIdentity {
  readonly resolved: ResolvedShapeTransform | null;
}

interface PlaceholderResolver {
  readonly layout: readonly PlaceholderDefinition[];
}

const COMPATIBLE_MASTER_PLACEHOLDER_TYPES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  body: ["body"],
  ctrTitle: ["title", "ctrTitle"],
  dt: ["dt"],
  ftr: ["ftr"],
  hdr: ["hdr"],
  sldImg: ["sldImg"],
  sldNum: ["sldNum"],
  subTitle: ["body", "subTitle"],
  title: ["title"],
  vertBody: ["body", "vertBody"],
  vertTitle: ["title", "vertTitle"],
});

interface ResolutionState {
  readonly shapes: ShapeGeometry[];
  readonly unsupported: UnsupportedShapeGeometry[];
  zIndex: number;
}

export function resolveSlideGeometry(
  slide: XmlElement,
  inheritance: SlideGeometryInheritance = {},
): SlideGeometry {
  const shapeTree = shapeTreeFor(slide);
  if (shapeTree === undefined) return { shapes: [], unsupported: [] };

  const state: ResolutionState = { shapes: [], unsupported: [], zIndex: 0 };
  const placeholders = buildPlaceholderResolver(inheritance);
  resolveChildren(shapeTree, IDENTITY_MATRIX, [], placeholders, state);
  return { shapes: state.shapes, unsupported: state.unsupported };
}

function resolveChildren(
  container: XmlElement,
  parentMatrix: AffineMatrix,
  parentShapeIds: readonly number[],
  placeholders: PlaceholderResolver,
  state: ResolutionState,
): void {
  for (const element of childElements(container)) {
    const kind = shapeKind(element);
    if (kind === null) continue;
    const metadata = shapeMetadata(element, kind);

    if (metadata.hidden === true) continue;
    if (metadata.hidden === null) {
      if (kind === "group") {
        markUnsupportedDescendants(
          element,
          "The containing group has an invalid hidden attribute.",
          state,
        );
      } else {
        state.unsupported.push({
          shapeId: metadata.id,
          shapeName: metadata.name,
          reason: "The shape has an invalid hidden attribute.",
        });
        state.zIndex += 1;
      }
      continue;
    }

    if (kind === "group") {
      const transform = groupTransform(element);
      if (transform === null) {
        markUnsupportedDescendants(
          element,
          "The containing group has an incomplete or invalid transform.",
          state,
        );
        continue;
      }
      const groupIdPath =
        metadata.id === null
          ? parentShapeIds
          : [...parentShapeIds, metadata.id];
      resolveChildren(
        element,
        composeMatrices(parentMatrix, groupTransformMatrix(transform)),
        groupIdPath,
        placeholders,
        state,
      );
      continue;
    }

    const zIndex = state.zIndex;
    state.zIndex += 1;
    if (metadata.id === null) {
      state.unsupported.push({
        shapeId: null,
        shapeName: metadata.name,
        reason: "The shape has no valid non-visual ID.",
      });
      continue;
    }
    const resolvedTransform = resolveShapeTransform(
      element,
      kind,
      parentMatrix,
      parentShapeIds,
      placeholders,
    );
    if (resolvedTransform === null) {
      const placeholder = placeholderIdentity(element, kind);
      state.unsupported.push({
        shapeId: metadata.id,
        shapeName: metadata.name,
        reason:
          placeholder === null
            ? "The shape has an incomplete, invalid, or degenerate transform."
            : `The placeholder transform for idx ${JSON.stringify(placeholder.index)} could not be resolved through its slide layout and master.`,
      });
      continue;
    }
    const { matrix, transform } = resolvedTransform;
    const polygon = transformPoints(
      matrix,
      rectanglePolygon({
        x: 0,
        y: 0,
        width: transform.width,
        height: transform.height,
      }),
    );
    const bounds = polygonBounds(polygon);
    if (bounds === null || bounds.width <= 0 || bounds.height <= 0) {
      state.unsupported.push({
        shapeId: metadata.id,
        shapeName: metadata.name,
        reason: "The transformed shape has degenerate bounds.",
      });
      continue;
    }
    const isTable = hasDrawingDescendant(element, "tbl");
    const textFrames = resolveTextFrames(
      element,
      kind,
      matrix,
      transform,
      polygon,
      bounds,
    );
    state.shapes.push({
      shapeId: metadata.id,
      shapeName: metadata.name,
      kind,
      zIndex,
      parentShapeIds,
      polygon,
      bounds,
      opacity: resolveShapeOpacity(element, kind),
      textFrames,
      hasVisibleText: textFrames.length > 0,
      isTable,
    });
  }
}

function resolveShapeOpacity(
  shape: XmlElement,
  kind: Exclude<LocalShapeKind, "group">,
): OpacityEvidence {
  if (kind === "picture") return pictureOpacity(shape);
  if (kind !== "shape") {
    return { state: "unknown", basis: "unsupported-shape-kind" };
  }

  const properties = directPresentationChild(shape, "spPr");
  if (properties === undefined) {
    return { state: "unknown", basis: "fill-unresolved" };
  }
  const fills = childElements(properties).filter(
    (child) =>
      isDrawingNamespace(child.name.namespaceUri) &&
      [
        "blipFill",
        "gradFill",
        "grpFill",
        "noFill",
        "pattFill",
        "solidFill",
      ].includes(child.name.localName),
  );
  if (fills.length !== 1) {
    return { state: "unknown", basis: "fill-unresolved" };
  }
  const fill = fills[0];
  if (fill?.name.localName === "noFill") {
    return { state: "not-opaque", basis: "no-fill", alpha: 0 };
  }
  if (fill?.name.localName !== "solidFill") {
    return { state: "unknown", basis: "unsupported-fill" };
  }
  const presetGeometry = directDrawingChild(properties, "prstGeom");
  if (attribute(presetGeometry, "prst") !== "rect") {
    return { state: "unknown", basis: "unsupported-shape-geometry" };
  }
  if (hasOpacityChangingShapeEffects(properties)) {
    return { state: "unknown", basis: "shape-effects-unresolved" };
  }
  return solidFillOpacity(fill);
}

function solidFillOpacity(fill: XmlElement): OpacityEvidence {
  const colorChoices = childElements(fill).filter(
    (child) =>
      isDrawingNamespace(child.name.namespaceUri) &&
      [
        "hslClr",
        "prstClr",
        "schemeClr",
        "scrgbClr",
        "srgbClr",
        "sysClr",
      ].includes(child.name.localName),
  );
  if (colorChoices.length !== 1) {
    return { state: "unknown", basis: "unsupported-fill" };
  }

  const color = colorChoices[0] ?? fill;
  let alpha: number | null = color.name.localName === "schemeClr" ? null : 1;
  for (const transform of childElements(color)) {
    if (
      !isDrawingNamespace(transform.name.namespaceUri) ||
      !transform.name.localName.startsWith("alpha")
    ) {
      continue;
    }
    const rawValue = optionalIntegerAttribute(transform, "val");
    if (rawValue === null) {
      return { state: "unknown", basis: "unsupported-fill" };
    }
    if (transform.name.localName === "alpha") {
      if (rawValue < 0 || rawValue > 100_000) {
        return { state: "unknown", basis: "unsupported-fill" };
      }
      alpha = rawValue / 100_000;
    } else if (transform.name.localName === "alphaMod") {
      if (rawValue < 0 || rawValue > 100_000) {
        return { state: "unknown", basis: "unsupported-fill" };
      }
      if (alpha !== null) alpha *= rawValue / 100_000;
    } else if (transform.name.localName === "alphaOff") {
      if (rawValue < -100_000 || rawValue > 100_000) {
        return { state: "unknown", basis: "unsupported-fill" };
      }
      if (alpha !== null) alpha += rawValue / 100_000;
    } else {
      return { state: "unknown", basis: "unsupported-fill" };
    }
    if (alpha !== null) alpha = Math.max(0, Math.min(1, alpha));
  }
  if (alpha === null) {
    return { state: "unknown", basis: "theme-color-unresolved" };
  }
  return alpha === 1
    ? { state: "opaque", basis: "solid-fill", alpha }
    : { state: "not-opaque", basis: "solid-fill", alpha };
}

function pictureOpacity(shape: XmlElement): OpacityEvidence {
  const properties = directPresentationChild(shape, "spPr");
  const presetGeometry =
    properties === undefined
      ? undefined
      : directDrawingChild(properties, "prstGeom");
  if (attribute(presetGeometry, "prst") !== "rect") {
    return { state: "unknown", basis: "unsupported-shape-geometry" };
  }
  if (hasOpacityChangingShapeEffects(properties)) {
    return { state: "unknown", basis: "shape-effects-unresolved" };
  }
  const fill = directPresentationChild(shape, "blipFill");
  const blip =
    fill === undefined ? undefined : directDrawingChild(fill, "blip");
  if (blip === undefined) {
    return { state: "unknown", basis: "image-reference-unresolved" };
  }

  const relationshipId =
    getAttribute(blip, OFFICE_RELATIONSHIPS_NAMESPACE, "embed")?.value ??
    getAttribute(blip, STRICT_OFFICE_RELATIONSHIPS_NAMESPACE, "embed")?.value;
  if (relationshipId === undefined || relationshipId === "") {
    return { state: "unknown", basis: "image-reference-unresolved" };
  }

  const effects = childElements(blip).filter((child) =>
    isDrawingNamespace(child.name.namespaceUri),
  );
  for (const effect of effects) {
    if (effect.name.localName === "alphaModFix") {
      const amount = optionalIntegerAttribute(effect, "amt");
      if (amount === null || amount < 0 || amount > 100_000) {
        return {
          state: "unknown",
          basis: "image-alpha-effect",
          imageRelationshipId: relationshipId,
        };
      }
      if (amount < 100_000) {
        return {
          state: "not-opaque",
          basis: "image-alpha-effect",
          alpha: amount / 100_000,
          imageRelationshipId: relationshipId,
        };
      }
      continue;
    }
    if (effect.name.localName.startsWith("alpha")) {
      return {
        state: "unknown",
        basis: "image-alpha-effect",
        imageRelationshipId: relationshipId,
      };
    }
    if (
      !["biLevel", "duotone", "grayscl", "hsl", "lum", "tint"].includes(
        effect.name.localName,
      )
    ) {
      return {
        state: "unknown",
        basis: "image-effects-unresolved",
        imageRelationshipId: relationshipId,
      };
    }
  }
  return {
    state: "unknown",
    basis: "embedded-image",
    imageRelationshipId: relationshipId,
  };
}

function hasOpacityChangingShapeEffects(
  properties: XmlElement | undefined,
): boolean {
  if (properties === undefined) return false;
  if (directDrawingChild(properties, "effectDag") !== undefined) return true;
  const effects = directDrawingChild(properties, "effectLst");
  if (effects === undefined) return false;
  return childElements(effects).some(
    (effect) =>
      isDrawingNamespace(effect.name.namespaceUri) &&
      ["blur", "fillOverlay", "softEdge"].includes(effect.name.localName),
  );
}

function groupTransformMatrix(transform: GroupTransform): AffineMatrix {
  return composeMatrices(
    translationMatrix(transform.x, transform.y),
    translationMatrix(transform.width / 2, transform.height / 2),
    rotationMatrix(transform.rotationDegrees),
    scaleMatrix(
      transform.flipHorizontal ? -1 : 1,
      transform.flipVertical ? -1 : 1,
    ),
    translationMatrix(-transform.width / 2, -transform.height / 2),
    scaleMatrix(
      transform.width / transform.childWidth,
      transform.height / transform.childHeight,
    ),
    translationMatrix(-transform.childX, -transform.childY),
  );
}

function shapeTransformMatrix(transform: Transform2D): AffineMatrix {
  return composeMatrices(
    translationMatrix(transform.x, transform.y),
    translationMatrix(transform.width / 2, transform.height / 2),
    rotationMatrix(transform.rotationDegrees),
    scaleMatrix(
      transform.flipHorizontal ? -1 : 1,
      transform.flipVertical ? -1 : 1,
    ),
    translationMatrix(-transform.width / 2, -transform.height / 2),
  );
}

function groupTransform(group: XmlElement): GroupTransform | null {
  const properties = directPresentationChild(group, "grpSpPr");
  const transform =
    properties === undefined
      ? undefined
      : directDrawingChild(properties, "xfrm");
  if (transform === undefined) return null;
  const base = parseTransform(transform);
  const childOffset = directDrawingChild(transform, "chOff");
  const childExtent = directDrawingChild(transform, "chExt");
  const childX = coordinateAttribute(childOffset, "x");
  const childY = coordinateAttribute(childOffset, "y");
  const childWidth = coordinateAttribute(childExtent, "cx");
  const childHeight = coordinateAttribute(childExtent, "cy");
  if (
    base === null ||
    childX === null ||
    childY === null ||
    childWidth === null ||
    childHeight === null ||
    childWidth <= 0 ||
    childHeight <= 0
  ) {
    return null;
  }
  return { ...base, childX, childY, childWidth, childHeight };
}

function resolveShapeTransform(
  shape: XmlElement,
  kind: Exclude<LocalShapeKind, "group">,
  parentMatrix: AffineMatrix,
  parentShapeIds: readonly number[],
  placeholders: PlaceholderResolver,
): ResolvedShapeTransform | null {
  const transformElement = shapeTransformElement(shape, kind);
  if (transformElement !== undefined) {
    const transform = parseTransform(transformElement);
    return transform === null
      ? null
      : {
          transform,
          matrix: composeMatrices(
            parentMatrix,
            shapeTransformMatrix(transform),
          ),
        };
  }
  if (parentShapeIds.length > 0) return null;
  const placeholder = placeholderIdentity(shape, kind);
  if (placeholder === null) return null;
  const matches = placeholders.layout.filter(
    (candidate) => candidate.index === placeholder.index,
  );
  return matches.length === 1 ? (matches[0]?.resolved ?? null) : null;
}

function shapeTransformElement(
  shape: XmlElement,
  kind: Exclude<LocalShapeKind, "group">,
): XmlElement | undefined {
  let transform: XmlElement | undefined;
  if (kind === "graphic-frame" || kind === "content-part") {
    transform = directPresentationChild(shape, "xfrm");
  } else {
    const properties = directPresentationChild(shape, "spPr");
    transform =
      properties === undefined
        ? undefined
        : directDrawingChild(properties, "xfrm");
  }
  return transform;
}

function parseTransform(transform: XmlElement): Transform2D | null {
  const offset = directDrawingChild(transform, "off");
  const extent = directDrawingChild(transform, "ext");
  const x = coordinateAttribute(offset, "x");
  const y = coordinateAttribute(offset, "y");
  const width = coordinateAttribute(extent, "cx");
  const height = coordinateAttribute(extent, "cy");
  const rotation = integerAttributeWithDefault(transform, "rot", 0);
  const flipHorizontal = optionalBooleanAttribute(transform, "flipH");
  const flipVertical = optionalBooleanAttribute(transform, "flipV");
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    rotation === null ||
    flipHorizontal === null ||
    flipVertical === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    x,
    y,
    width,
    height,
    rotationDegrees: rotation / 60_000,
    flipHorizontal,
    flipVertical,
  };
}

function shapeMetadata(shape: XmlElement, kind: LocalShapeKind): ShapeMetadata {
  const wrapper = nonVisualWrapper(shape, kind);
  const properties =
    wrapper === undefined
      ? undefined
      : directPresentationChild(wrapper, "cNvPr");
  return {
    id: optionalNonNegativeIntegerAttribute(properties, "id"),
    name: attribute(properties, "name"),
    hidden:
      properties === undefined
        ? false
        : optionalBooleanAttribute(properties, "hidden"),
  };
}

function nonVisualWrapper(
  shape: XmlElement,
  kind: LocalShapeKind,
): XmlElement | undefined {
  const wrapperName =
    kind === "connector"
      ? "nvCxnSpPr"
      : kind === "content-part"
        ? "nvContentPartPr"
        : kind === "graphic-frame"
          ? "nvGraphicFramePr"
          : kind === "group"
            ? "nvGrpSpPr"
            : kind === "picture"
              ? "nvPicPr"
              : "nvSpPr";
  return directPresentationChild(shape, wrapperName);
}

function buildPlaceholderResolver(
  inheritance: SlideGeometryInheritance,
): PlaceholderResolver {
  const master =
    inheritance.master === undefined
      ? []
      : collectPlaceholderDefinitions(inheritance.master, []);
  const layout =
    inheritance.layout === undefined
      ? []
      : collectPlaceholderDefinitions(inheritance.layout, master);
  return { layout };
}

function collectPlaceholderDefinitions(
  root: XmlElement,
  fallback: readonly PlaceholderDefinition[],
): readonly PlaceholderDefinition[] {
  const shapeTree = shapeTreeFor(root);
  if (shapeTree === undefined) return [];
  const definitions: PlaceholderDefinition[] = [];
  collectPlaceholderChildren(shapeTree, IDENTITY_MATRIX, fallback, definitions);
  return definitions;
}

function collectPlaceholderChildren(
  container: XmlElement,
  parentMatrix: AffineMatrix | null,
  fallback: readonly PlaceholderDefinition[],
  definitions: PlaceholderDefinition[],
): void {
  for (const element of childElements(container)) {
    const kind = shapeKind(element);
    if (kind === null) continue;
    if (kind === "group") {
      const transform = groupTransform(element);
      collectPlaceholderChildren(
        element,
        parentMatrix === null || transform === null
          ? null
          : composeMatrices(parentMatrix, groupTransformMatrix(transform)),
        fallback,
        definitions,
      );
      continue;
    }

    const identity = placeholderIdentity(element, kind);
    if (identity === null) continue;
    const transformElement = shapeTransformElement(element, kind);
    let resolved: ResolvedShapeTransform | null = null;
    if (transformElement === undefined) {
      resolved = inheritedPlaceholderTransform(identity, fallback);
    } else if (parentMatrix !== null) {
      const transform = parseTransform(transformElement);
      if (transform !== null) {
        resolved = {
          transform,
          matrix: composeMatrices(
            parentMatrix,
            shapeTransformMatrix(transform),
          ),
        };
      }
    }
    definitions.push({ ...identity, resolved });
  }
}

function inheritedPlaceholderTransform(
  identity: PlaceholderIdentity,
  fallback: readonly PlaceholderDefinition[],
): ResolvedShapeTransform | null {
  const compatibleTypes =
    COMPATIBLE_MASTER_PLACEHOLDER_TYPES[identity.type] ?? [];
  const compatible = fallback.filter((candidate) =>
    compatibleTypes.includes(candidate.type),
  );
  const match =
    compatible.find((candidate) => candidate.index === identity.index) ??
    (compatible.length === 1 ? compatible[0] : undefined);
  return match?.resolved ?? null;
}

function placeholderIdentity(
  shape: XmlElement,
  kind: LocalShapeKind,
): PlaceholderIdentity | null {
  const wrapper = nonVisualWrapper(shape, kind);
  const applicationProperties =
    wrapper === undefined
      ? undefined
      : directPresentationChild(wrapper, "nvPr");
  const placeholder =
    applicationProperties === undefined
      ? undefined
      : directPresentationChild(applicationProperties, "ph");
  if (placeholder === undefined) return null;
  const rawIndex = attribute(placeholder, "idx") ?? "0";
  if (!/^[0-9]+$/u.test(rawIndex)) return null;
  const parsedIndex = Number(rawIndex);
  if (!Number.isSafeInteger(parsedIndex)) return null;
  const type = attribute(placeholder, "type") ?? "obj";
  if (type === "") return null;
  return { index: String(parsedIndex), type };
}

function shapeTreeFor(root: XmlElement): XmlElement | undefined {
  const commonSlideData = directPresentationChild(root, "cSld");
  return commonSlideData === undefined
    ? undefined
    : directPresentationChild(commonSlideData, "spTree");
}

function markUnsupportedDescendants(
  group: XmlElement,
  reason: string,
  state: ResolutionState,
): void {
  for (const element of childElements(group)) {
    const kind = shapeKind(element);
    if (kind === null) continue;
    const metadata = shapeMetadata(element, kind);
    if (kind === "group") {
      markUnsupportedDescendants(element, reason, state);
    } else {
      state.unsupported.push({
        shapeId: metadata.id,
        shapeName: metadata.name,
        reason,
      });
      state.zIndex += 1;
    }
  }
}

function resolveTextFrames(
  shape: XmlElement,
  kind: Exclude<LocalShapeKind, "group">,
  matrix: AffineMatrix,
  transform: Transform2D,
  shapePolygon: readonly Point[],
  shapeBounds: Rectangle,
): readonly TextFrameGeometry[] {
  if (kind === "shape") {
    const textBody = directPresentationChild(shape, "txBody");
    return textBody !== undefined && containsVisibleText(textBody)
      ? [{ key: "shape", polygon: shapePolygon, bounds: shapeBounds }]
      : [];
  }
  if (kind !== "graphic-frame") return [];
  const table = drawingDescendants(shape, "tbl")[0];
  return table === undefined
    ? []
    : resolveTableTextFrames(table, matrix, transform);
}

function resolveTableTextFrames(
  table: XmlElement,
  matrix: AffineMatrix,
  transform: Transform2D,
): readonly TextFrameGeometry[] {
  const grid = directDrawingChild(table, "tblGrid");
  if (grid === undefined) return [];
  const columnWidths = childElements(grid)
    .filter(
      (element) =>
        isDrawingNamespace(element.name.namespaceUri) &&
        element.name.localName === "gridCol",
    )
    .map((element) => positiveIntegerAttribute(element, "w"));
  const rows = childElements(table).filter(
    (element) =>
      isDrawingNamespace(element.name.namespaceUri) &&
      element.name.localName === "tr",
  );
  const rowHeights = rows.map((row) => positiveIntegerAttribute(row, "h"));
  if (
    columnWidths.length === 0 ||
    columnWidths.some((width) => width === null) ||
    rowHeights.length === 0 ||
    rowHeights.some((height) => height === null)
  ) {
    return [];
  }
  const widths = columnWidths.filter(
    (width): width is number => width !== null,
  );
  const heights = rowHeights.filter(
    (height): height is number => height !== null,
  );
  const totalWidth = sum(widths);
  const totalHeight = sum(heights);
  if (totalWidth <= 0 || totalHeight <= 0) return [];
  const horizontalScale = transform.width / totalWidth;
  const verticalScale = transform.height / totalHeight;
  const frames: TextFrameGeometry[] = [];
  let rowY = 0;

  for (const [rowIndex, row] of rows.entries()) {
    let columnIndex = 0;
    const cells = childElements(row).filter(
      (element) =>
        isDrawingNamespace(element.name.namespaceUri) &&
        element.name.localName === "tc",
    );
    for (const [cellPosition, cell] of cells.entries()) {
      const columnSpan = positiveIntegerAttribute(cell, "gridSpan") ?? 1;
      const rowSpan = positiveIntegerAttribute(cell, "rowSpan") ?? 1;
      const cellWidth = sum(
        widths.slice(columnIndex, columnIndex + columnSpan),
      );
      const cellHeight = sum(heights.slice(rowIndex, rowIndex + rowSpan));
      const isHorizontalMergeContinuation =
        optionalBooleanAttribute(cell, "hMerge") === true;
      const isVerticalMergeContinuation =
        optionalBooleanAttribute(cell, "vMerge") === true;
      const isMergeContinuation =
        isHorizontalMergeContinuation || isVerticalMergeContinuation;
      const hasHorizontalContinuationCells =
        columnSpan > 1 &&
        cells
          .slice(cellPosition + 1, cellPosition + columnSpan)
          .filter(
            (candidate) =>
              optionalBooleanAttribute(candidate, "hMerge") === true,
          ).length ===
          columnSpan - 1;
      if (
        !isMergeContinuation &&
        cellWidth > 0 &&
        cellHeight > 0 &&
        containsVisibleText(cell)
      ) {
        const localRectangle = {
          x: sum(widths.slice(0, columnIndex)) * horizontalScale,
          y: rowY * verticalScale,
          width: cellWidth * horizontalScale,
          height: cellHeight * verticalScale,
        };
        const polygon = transformPoints(
          matrix,
          rectanglePolygon(localRectangle),
        );
        const bounds = polygonBounds(polygon);
        if (bounds !== null && bounds.width > 0 && bounds.height > 0) {
          frames.push({
            key: `table:r${String(rowIndex)}:c${String(columnIndex)}`,
            polygon,
            bounds,
          });
        }
      }
      columnIndex +=
        isHorizontalMergeContinuation || hasHorizontalContinuationCells
          ? 1
          : columnSpan;
    }
    rowY += heights[rowIndex] ?? 0;
  }
  return frames;
}

function containsVisibleText(element: XmlElement): boolean {
  return drawingDescendants(element, "t").some(
    (text) => textContent(text).trim() !== "",
  );
}

function drawingDescendants(
  element: XmlElement,
  localName: string,
): readonly XmlElement[] {
  return findDescendants(element, DRAWINGML_NAMESPACE, localName).concat(
    findDescendants(element, STRICT_DRAWINGML_NAMESPACE, localName),
  );
}

function textContent(element: XmlElement): string {
  return element.children.map(nodeText).join("");
}

function nodeText(node: XmlNode): string {
  return node.kind === "text" || node.kind === "cdata" ? node.value : "";
}

function hasDrawingDescendant(element: XmlElement, localName: string): boolean {
  return drawingDescendants(element, localName).length > 0;
}

function shapeKind(element: XmlElement): LocalShapeKind | null {
  if (!isPresentationNamespace(element.name.namespaceUri)) return null;
  switch (element.name.localName) {
    case "cxnSp":
      return "connector";
    case "contentPart":
      return "content-part";
    case "graphicFrame":
      return "graphic-frame";
    case "grpSp":
      return "group";
    case "pic":
      return "picture";
    case "sp":
      return "shape";
    default:
      return null;
  }
}

function directPresentationChild(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  return childElements(element).find(
    (child) =>
      isPresentationNamespace(child.name.namespaceUri) &&
      child.name.localName === localName,
  );
}

function directDrawingChild(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  return childElements(element).find(
    (child) =>
      isDrawingNamespace(child.name.namespaceUri) &&
      child.name.localName === localName,
  );
}

function isPresentationNamespace(namespaceUri: string | null): boolean {
  return (
    namespaceUri === PRESENTATIONML_NAMESPACE ||
    namespaceUri === STRICT_PRESENTATIONML_NAMESPACE
  );
}

function isDrawingNamespace(namespaceUri: string | null): boolean {
  return (
    namespaceUri === DRAWINGML_NAMESPACE ||
    namespaceUri === STRICT_DRAWINGML_NAMESPACE
  );
}

function coordinateAttribute(
  element: XmlElement | undefined,
  localName: string,
): number | null {
  return optionalIntegerAttribute(element, localName);
}

function optionalNonNegativeIntegerAttribute(
  element: XmlElement | undefined,
  localName: string,
): number | null {
  const value = optionalIntegerAttribute(element, localName);
  return value !== null && value >= 0 ? value : null;
}

function positiveIntegerAttribute(
  element: XmlElement,
  localName: string,
): number | null {
  const value = optionalIntegerAttribute(element, localName);
  return value !== null && value > 0 ? value : null;
}

function optionalIntegerAttribute(
  element: XmlElement | undefined,
  localName: string,
): number | null {
  const value = attribute(element, localName);
  if (value === null || !/^-?[0-9]+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function integerAttributeWithDefault(
  element: XmlElement,
  localName: string,
  fallback: number,
): number | null {
  return attribute(element, localName) === null
    ? fallback
    : optionalIntegerAttribute(element, localName);
}

function optionalBooleanAttribute(
  element: XmlElement,
  localName: string,
): boolean | null {
  const value = attribute(element, localName);
  if (value === null || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  return null;
}

function attribute(
  element: XmlElement | undefined,
  localName: string,
): string | null {
  return element === undefined
    ? null
    : (getAttribute(element, null, localName)?.value ?? null);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
