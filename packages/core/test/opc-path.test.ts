import { describe, expect, it } from "vitest";

import {
  canonicalizeEntryPartName,
  encodeInputKeyPath,
  normalizeInputKey,
  resolveRelationshipTarget,
} from "../src/index.js";

describe("OPC part paths", () => {
  it.each([
    [null, "ppt/presentation.xml", "ppt/presentation.xml"],
    ["ppt/presentation.xml", "slides/slide7.xml", "ppt/slides/slide7.xml"],
    [
      "ppt/slides/slide7.xml",
      "../slideLayouts/slide3.xml",
      "ppt/slideLayouts/slide3.xml",
    ],
    ["ppt/slides/slide7.xml", "/docProps/core.xml", "docProps/core.xml"],
    ["ppt/a/b.xml", "./media/../image.png", "ppt/a/image.png"],
  ])("resolves %s + %s", (source, target, expected) => {
    expect(resolveRelationshipTarget(source, target)).toEqual({
      ok: true,
      partName: expected,
    });
  });

  it.each([
    "../../escape.xml",
    "https://example.test/x",
    "a\\b.xml",
    "a.xml#x",
  ])("rejects unsafe internal target %s", (target) => {
    expect(resolveRelationshipTarget("ppt/presentation.xml", target).ok).toBe(
      false,
    );
  });

  it("canonicalizes harmless segments without hiding ambiguous names", () => {
    expect(canonicalizeEntryPartName("ppt/./slides//slide1.xml")).toEqual({
      ok: true,
      partName: "ppt/slides/slide1.xml",
    });
    expect(canonicalizeEntryPartName("../outside.xml").ok).toBe(false);
    expect(canonicalizeEntryPartName("/absolute.xml").ok).toBe(false);
  });

  it("normalizes only relative input keys", () => {
    expect(normalizeInputKey("./decks\\review/../final.pptx")).toBe(
      "decks/final.pptx",
    );
    expect(() => normalizeInputKey("/tmp/final.pptx")).toThrow(TypeError);
    expect(() => normalizeInputKey("../final.pptx")).toThrow(TypeError);
  });

  it("encodes input-key components without conflating POSIX backslashes", () => {
    expect(encodeInputKeyPath("decks/a%b:c\\d.pptx", "/")).toBe(
      "decks/a%25b%3Ac%5Cd.pptx",
    );
    expect(encodeInputKeyPath("decks\\a%b:c.pptx", "\\")).toBe(
      "decks/a%25b%3Ac.pptx",
    );
  });
});
