import { describe, expect, it } from "vitest";

import {
  composeMatrices,
  intersectConvexPolygons,
  parseXml,
  polygonArea,
  rectanglePolygon,
  resolveSlideGeometry,
  rotationMatrix,
  transformPoint,
  translationMatrix,
} from "../src/index.js";
import {
  DRAWINGML_NAMESPACE,
  PRESENTATIONML_NAMESPACE,
} from "../../../fixtures/builders/index.js";

describe("affine and polygon geometry", () => {
  it("composes clockwise rotations around an offset rectangle center", () => {
    const matrix = composeMatrices(
      translationMatrix(10, 20),
      translationMatrix(5, 5),
      rotationMatrix(90),
      translationMatrix(-5, -5),
    );

    expect(transformPoint(matrix, { x: 0, y: 0 })).toMatchObject({
      x: 20,
      y: 20,
    });
    expect(transformPoint(matrix, { x: 10, y: 0 })).toMatchObject({
      x: 20,
      y: 30,
    });
  });

  it("intersects transformed convex polygons without bbox over-counting", () => {
    const first = rectanglePolygon({ x: 0, y: 0, width: 100, height: 100 });
    const second = rectanglePolygon({
      x: 75,
      y: 25,
      width: 100,
      height: 100,
    });
    const intersection = intersectConvexPolygons(first, second);

    expect(polygonArea(intersection)).toBe(1_875);
    expect(intersection).toHaveLength(4);
  });
});

describe("PresentationML shape geometry", () => {
  it("applies nested group child spaces, scaling, flips, and rotation", () => {
    const parsed = parseXml(`<?xml version="1.0"?>
      <p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}">
        <p:cSld><p:spTree>
          <p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm/></p:grpSpPr>
          <p:grpSp>
            <p:nvGrpSpPr><p:cNvPr id="10" name="Outer"/></p:nvGrpSpPr>
            <p:grpSpPr><a:xfrm>
              <a:off x="100" y="200"/><a:ext cx="400" cy="200"/>
              <a:chOff x="0" y="0"/><a:chExt cx="200" cy="100"/>
            </a:xfrm></p:grpSpPr>
            <p:grpSp>
              <p:nvGrpSpPr><p:cNvPr id="11" name="Inner"/></p:nvGrpSpPr>
              <p:grpSpPr><a:xfrm rot="5400000" flipH="1">
                <a:off x="50" y="25"/><a:ext cx="100" cy="50"/>
                <a:chOff x="0" y="0"/><a:chExt cx="100" cy="50"/>
              </a:xfrm></p:grpSpPr>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="12" name="Nested"/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="50"/></a:xfrm></p:spPr>
                <p:txBody><a:p><a:r><a:t>Visible</a:t></a:r></a:p></p:txBody>
              </p:sp>
            </p:grpSp>
          </p:grpSp>
        </p:spTree></p:cSld>
      </p:sld>`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = resolveSlideGeometry(parsed.document.root);

    expect(resolved.unsupported).toEqual([]);
    expect(resolved.shapes).toHaveLength(1);
    expect(resolved.shapes[0]).toMatchObject({
      shapeId: 12,
      shapeName: "Nested",
      parentShapeIds: [10, 11],
      hasVisibleText: true,
      bounds: { x: 250, y: 200, width: 100, height: 200 },
    });
    expect(resolved.shapes[0]?.polygon[0]).toMatchObject({ x: 350, y: 400 });
  });

  it("records unsupported transforms instead of guessing geometry", () => {
    const parsed = parseXml(`<?xml version="1.0"?>
      <p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="9" name="No transform"/></p:nvSpPr>
            <p:spPr/>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(resolveSlideGeometry(parsed.document.root)).toMatchObject({
      shapes: [],
      unsupported: [{ shapeId: 9, shapeName: "No transform" }],
    });
  });
});
