export {
  composeMatrices,
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  transformPoints,
  translationMatrix,
} from "./affine.js";
export type { AffineMatrix, Point } from "./affine.js";
export {
  clipPolygonToRectangle,
  intersectConvexPolygons,
  polygonArea,
  polygonBounds,
  rectanglePolygon,
  signedPolygonArea,
} from "./polygon.js";
export type { Rectangle } from "./polygon.js";
export { inspectRasterOpacity } from "./opacity.js";
export type {
  OpacityBasis,
  OpacityEvidence,
  OpacityState,
  RasterOpacityEvidence,
} from "./opacity.js";
export { resolveSlideGeometry } from "./shape-geometry.js";
export type {
  ShapeGeometry,
  SlideGeometry,
  SlideGeometryInheritance,
  TextFrameGeometry,
  UnsupportedShapeGeometry,
} from "./shape-geometry.js";
