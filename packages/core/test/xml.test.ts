import { describe, expect, it } from "vitest";

import {
  minimalSlideXml,
  PRESENTATIONML_NAMESPACE,
} from "../../../fixtures/builders/index.js";
import { findDescendants, getAttribute, parseXml } from "../src/xml/index.js";

describe("strict namespace-aware XML adapter", () => {
  it("resolves names by namespace URI independently of prefixes", () => {
    const first = parseXml(
      `<p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}"><p:cSld/></p:sld>`,
    );
    const second = parseXml(
      `<x:sld xmlns:x="${PRESENTATIONML_NAMESPACE}"><x:cSld/></x:sld>`,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.document.root.name).toMatchObject({
      namespaceUri: PRESENTATIONML_NAMESPACE,
      localName: "sld",
      prefix: "p",
    });
    expect(second.document.root.name).toMatchObject({
      namespaceUri: PRESENTATIONML_NAMESPACE,
      localName: "sld",
      prefix: "x",
    });
    expect(
      findDescendants(second.document.root, PRESENTATIONML_NAMESPACE, "cSld"),
    ).toHaveLength(1);
  });

  it("keeps unknown extension elements and namespaced attributes readable", () => {
    const result = parseXml(
      minimalSlideXml(
        '<future:widget xmlns:future="urn:example:future" future:mode="on"><future:value>42</future:value></future:widget>',
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const widgets = findDescendants(
      result.document.root,
      "urn:example:future",
      "widget",
    );
    expect(widgets).toHaveLength(1);
    const widget = widgets[0];
    if (widget === undefined) return;
    expect(getAttribute(widget, "urn:example:future", "mode")?.value).toBe(
      "on",
    );
    expect(
      findDescendants(result.document.root, "urn:example:future", "value")[0]
        ?.children,
    ).toContainEqual({ kind: "text", value: "42" });
  });

  it("does not apply a default namespace to unprefixed attributes", () => {
    const result = parseXml('<root xmlns="urn:root" id="7"/>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.root.name.namespaceUri).toBe("urn:root");
    expect(getAttribute(result.document.root, null, "id")?.value).toBe("7");
  });

  it("returns strict malformed XML diagnostics", () => {
    const result = parseXml(
      `<p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}"><p:cSld></p:sld>`,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "malformed-xml",
        line: 1,
      },
    });
  });

  it.each([
    '<!DOCTYPE root [<!ENTITY secret "not-safe">]><root>&secret;</root>',
    '<!DOCTYPE root SYSTEM "file:///etc/passwd"><root/>',
    '<!DOCTYPE root SYSTEM "https://example.invalid/external.dtd"><root/>',
  ])("rejects DTD/entity XML without resolving it", (xml) => {
    const result = parseXml(xml);
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "dtd-prohibited" },
    });
  });

  it("allows the five predefined XML entities", () => {
    const result = parseXml("<root>&amp;&lt;&gt;&apos;&quot;</root>");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.root.children).toContainEqual({
      kind: "text",
      value: "&<>'\"",
    });
  });

  it("rejects unbound namespace prefixes", () => {
    const result = parseXml("<root><future:item/></root>");
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-namespace" },
    });
  });

  it.each([
    '<a:1 xmlns:a="urn:a"/>',
    '<root xmlns:a="urn:a" a:1="x"/>',
    '<root xmlns:a:b="urn:x"/>',
  ])("rejects namespace names that are not valid NCNames", (xml) => {
    expect(parseXml(xml)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-namespace" },
    });
  });

  it("accepts non-ASCII NCNames", () => {
    const result = parseXml('<é:élément xmlns:é="urn:unicode" é:clé="1"/>');
    expect(result).toMatchObject({ ok: true });
  });

  it("decodes BOM-marked UTF-16 XML bytes", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-16"?><root xmlns="urn:utf16">ok</root>';
    const bytes = new Uint8Array(2 + xml.length * 2);
    bytes.set([0xff, 0xfe]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < xml.length; index += 1) {
      view.setUint16(2 + index * 2, xml.charCodeAt(index), true);
    }

    const result = parseXml(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.root.name.namespaceUri).toBe("urn:utf16");
    }
  });

  it.each([
    '<?xml version="1.0" encoding="UTF-16"?><root/>',
    '<?xml version="1.0" encoding="windows-1252"?><root/>',
  ])(
    "rejects unsupported or contradictory byte encoding declarations",
    (xml) => {
      const result = parseXml(new TextEncoder().encode(xml));
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "unsupported-encoding" },
      });
    },
  );

  it("rejects a UTF-16 byte stream declared as UTF-8", () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><root/>';
    const bytes = new Uint8Array(2 + xml.length * 2);
    bytes.set([0xff, 0xfe]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < xml.length; index += 1) {
      view.setUint16(2 + index * 2, xml.charCodeAt(index), true);
    }

    expect(parseXml(bytes)).toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-encoding" },
    });
  });
});
