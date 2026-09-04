import { describe, expect, it } from "vitest";

import {
  buildMinimalPptx,
  minimalSlideXml,
} from "../../../fixtures/builders/index.js";
import { openZipArchive } from "../src/archive/index.js";
import { findDescendants, parseXml } from "../src/xml/index.js";

const decoder = new TextDecoder();

describe("synthetic PPTX fixture builder", () => {
  it("generates byte-for-byte reproducible minimal PPTX files", () => {
    const first = buildMinimalPptx();
    const second = buildMinimalPptx();

    expect(first).toEqual(second);
    expect(first.byteLength).toBeGreaterThan(5_000);
  });

  it("contains well-formed XML for the minimum presentation part graph", async () => {
    const opened = await openZipArchive(buildMinimalPptx());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.archive.entries).toHaveLength(12);
    for (const entry of opened.archive.entries) {
      const read = await entry.read();
      expect(read.ok, entry.name).toBe(true);
      if (read.ok) {
        expect(parseXml(read.bytes), entry.name).toMatchObject({ ok: true });
      }
    }
    await opened.archive.close();
  });

  it("can append a duplicate PPTX part without overwriting the original", async () => {
    const opened = await openZipArchive(
      buildMinimalPptx({
        additionalEntries: [
          { name: "ppt/slides/slide1.xml", data: "<duplicate/>" },
        ],
      }),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.archive.duplicateNames).toEqual(["ppt/slides/slide1.xml"]);
    expect(
      opened.archive.entries.filter(
        (entry) => entry.name === "ppt/slides/slide1.xml",
      ),
    ).toHaveLength(2);
    await opened.archive.close();
  });

  it("lets tests replace slide XML without opaque binary fixtures", async () => {
    const cases = [
      {
        slideXml: "<p:sld>",
        diagnosticCode: "malformed-xml",
      },
      {
        slideXml:
          '<!DOCTYPE p:sld SYSTEM "https://example.invalid/a.dtd"><p:sld xmlns:p="urn:p"/>',
        diagnosticCode: "dtd-prohibited",
      },
    ] as const;

    for (const fixtureCase of cases) {
      const opened = await openZipArchive(
        buildMinimalPptx({ slideXml: fixtureCase.slideXml }),
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) continue;

      const slide = opened.archive.entries.find(
        (entry) => entry.name === "ppt/slides/slide1.xml",
      );
      const read = await slide?.read();
      expect(read?.ok).toBe(true);
      if (read?.ok) {
        expect(parseXml(read.bytes)).toMatchObject({
          ok: false,
          diagnostic: { code: fixtureCase.diagnosticCode },
        });
      }
      await opened.archive.close();
    }
  });

  it("builds a readable fixture with an unknown XML extension", async () => {
    const bytes = buildMinimalPptx({
      slideXml: minimalSlideXml(
        '<vendor:feature xmlns:vendor="urn:vendor:extension" enabled="true"/>',
      ),
    });
    const opened = await openZipArchive(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const slide = opened.archive.entries.find(
      (entry) => entry.name === "ppt/slides/slide1.xml",
    );
    const read = await slide?.read();
    expect(read?.ok).toBe(true);
    if (read?.ok) {
      const xml = parseXml(decoder.decode(read.bytes));
      expect(xml.ok).toBe(true);
      if (xml.ok) {
        expect(
          findDescendants(xml.document.root, "urn:vendor:extension", "feature"),
        ).toHaveLength(1);
      }
    }
    await opened.archive.close();
  });
});
