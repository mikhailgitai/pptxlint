export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A two-dimensional affine matrix using the SVG/Canvas layout:
 *
 * x' = a*x + c*y + e
 * y' = b*x + d*y + f
 */
export interface AffineMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_MATRIX: AffineMatrix = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

/** Returns a matrix that applies `right` first and `left` second. */
export function multiplyMatrices(
  left: AffineMatrix,
  right: AffineMatrix,
): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function composeMatrices(
  ...matrices: readonly AffineMatrix[]
): AffineMatrix {
  return matrices.reduce(multiplyMatrices, IDENTITY_MATRIX);
}

export function translationMatrix(x: number, y: number): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleMatrix(x: number, y: number): AffineMatrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

/** Positive angles rotate clockwise in the slide's downward-positive Y axis. */
export function rotationMatrix(degrees: number): AffineMatrix {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    e: 0,
    f: 0,
  };
}

export function transformPoint(matrix: AffineMatrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function transformPoints(
  matrix: AffineMatrix,
  points: readonly Point[],
): readonly Point[] {
  return points.map((point) => transformPoint(matrix, point));
}
