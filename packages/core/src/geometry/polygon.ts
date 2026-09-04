import type { Point } from "./affine.js";

export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const GEOMETRY_EPSILON = 1e-9;

export function rectanglePolygon(rectangle: Rectangle): readonly Point[] {
  const right = rectangle.x + rectangle.width;
  const bottom = rectangle.y + rectangle.height;
  return [
    { x: rectangle.x, y: rectangle.y },
    { x: right, y: rectangle.y },
    { x: right, y: bottom },
    { x: rectangle.x, y: bottom },
  ];
}

export function signedPolygonArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  let doubleArea = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length];
    if (next === undefined) continue;
    doubleArea += point.x * next.y - next.x * point.y;
  }
  return doubleArea / 2;
}

export function polygonArea(points: readonly Point[]): number {
  return Math.abs(signedPolygonArea(points));
}

export function polygonBounds(points: readonly Point[]): Rectangle | null {
  const first = points[0];
  if (first === undefined) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x;
  let bottom = first.y;
  for (const point of points.slice(1)) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Intersects two convex polygons using Sutherland-Hodgman clipping. */
export function intersectConvexPolygons(
  subject: readonly Point[],
  clip: readonly Point[],
): readonly Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientedClip =
    signedPolygonArea(clip) < 0 ? [...clip].reverse() : [...clip];
  let output = [...subject];

  for (const [index, clipStart] of orientedClip.entries()) {
    const clipEnd = orientedClip[(index + 1) % orientedClip.length];
    if (clipEnd === undefined || output.length === 0) return [];
    const input = output;
    output = [];
    let previous = input.at(-1);
    if (previous === undefined) return [];
    let previousDistance = edgeDistance(clipStart, clipEnd, previous);

    for (const current of input) {
      const currentDistance = edgeDistance(clipStart, clipEnd, current);
      const currentInside = currentDistance >= -GEOMETRY_EPSILON;
      const previousInside = previousDistance >= -GEOMETRY_EPSILON;
      if (currentInside !== previousInside) {
        const denominator = previousDistance - currentDistance;
        if (Math.abs(denominator) > GEOMETRY_EPSILON) {
          const amount = previousDistance / denominator;
          output.push({
            x: previous.x + amount * (current.x - previous.x),
            y: previous.y + amount * (current.y - previous.y),
          });
        }
      }
      if (currentInside) output.push(current);
      previous = current;
      previousDistance = currentDistance;
    }
    output = removeAdjacentDuplicates(output);
  }

  return polygonArea(output) <= GEOMETRY_EPSILON ? [] : output;
}

export function clipPolygonToRectangle(
  polygon: readonly Point[],
  rectangle: Rectangle,
): readonly Point[] {
  if (rectangle.width <= 0 || rectangle.height <= 0) return [];
  return intersectConvexPolygons(polygon, rectanglePolygon(rectangle));
}

function edgeDistance(start: Point, end: Point, point: Point): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function removeAdjacentDuplicates(points: readonly Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const previous = unique.at(-1);
    if (
      previous === undefined ||
      Math.abs(point.x - previous.x) > GEOMETRY_EPSILON ||
      Math.abs(point.y - previous.y) > GEOMETRY_EPSILON
    ) {
      unique.push(point);
    }
  }
  const first = unique[0];
  const last = unique.at(-1);
  if (
    first !== undefined &&
    last !== undefined &&
    unique.length > 1 &&
    Math.abs(first.x - last.x) <= GEOMETRY_EPSILON &&
    Math.abs(first.y - last.y) <= GEOMETRY_EPSILON
  ) {
    unique.pop();
  }
  return unique;
}
