import {
  parseXml as parseXmlTree,
  XmlCdata as ParsedCdata,
  XmlComment as ParsedComment,
  XmlDocumentType as ParsedDocumentType,
  XmlElement as ParsedElement,
  XmlError as ParsedXmlError,
  XmlProcessingInstruction as ParsedProcessingInstruction,
  XmlText as ParsedText,
} from "@rgrove/parse-xml";

import { XML_NAMESPACE_URI, XMLNS_NAMESPACE_URI } from "./types.js";
import type {
  XmlAttribute,
  XmlDocument,
  XmlElement,
  XmlExpandedName,
  XmlNode,
  XmlParseDiagnostic,
  XmlParseResult,
} from "./types.js";

type NamespaceBindings = ReadonlyMap<string, string>;
type XmlByteEncoding = "utf-8" | "utf-16be" | "utf-16le";

class NamespaceError extends Error {}

/** Parses one complete XML document. Failures are returned as data. */
export function parseXml(input: string | Uint8Array): XmlParseResult {
  const decoded = decodeXml(input);
  if (!decoded.ok) {
    return decoded;
  }

  try {
    const documentTypeOffset = findDocumentTypeOffset(decoded.xml);
    if (documentTypeOffset !== -1) {
      return {
        ok: false,
        diagnostic: {
          code: "dtd-prohibited",
          message:
            "DOCTYPE and custom entity declarations are prohibited in PPTX XML parts.",
          ...positionAt(decoded.xml, documentTypeOffset),
        },
      };
    }

    const parsed = parseXmlTree(decoded.xml, {
      includeOffsets: true,
      preserveCdata: true,
      preserveComments: true,
      preserveDocumentType: true,
    });

    const documentType = parsed.children.find(
      (node) => node instanceof ParsedDocumentType,
    );
    if (documentType !== undefined) {
      const position = positionAt(decoded.xml, documentType.start);
      return {
        ok: false,
        diagnostic: {
          code: "dtd-prohibited",
          message:
            "DOCTYPE and custom entity declarations are prohibited in PPTX XML parts.",
          ...position,
        },
      };
    }

    if (parsed.root === null) {
      return malformed("XML document does not contain a root element.");
    }

    const initialBindings = new Map<string, string>([
      ["xml", XML_NAMESPACE_URI],
    ]);
    const document: XmlDocument = {
      root: convertElement(parsed.root, initialBindings),
    };
    return { ok: true, document };
  } catch (error) {
    if (error instanceof NamespaceError) {
      return {
        ok: false,
        diagnostic: {
          code: "invalid-namespace",
          message: error.message,
        },
      };
    }

    if (error instanceof ParsedXmlError) {
      return {
        ok: false,
        diagnostic: {
          code: "malformed-xml",
          message: error.message,
          line: error.line,
          column: error.column,
          offset: error.pos,
        },
      };
    }

    return malformed(error instanceof Error ? error.message : String(error));
  }
}

function convertElement(
  parsed: ParsedElement,
  inheritedBindings: NamespaceBindings,
): XmlElement {
  const bindings = new Map(inheritedBindings);

  for (const [qualifiedName, value] of Object.entries(parsed.attributes)) {
    applyNamespaceDeclaration(bindings, qualifiedName, value);
  }

  const name = expandName(parsed.name, bindings, true);
  const attributes: XmlAttribute[] = [];
  const expandedAttributes = new Set<string>();

  for (const [qualifiedName, value] of Object.entries(parsed.attributes)) {
    const attributeName = expandAttributeName(qualifiedName, bindings);
    const key = `${attributeName.namespaceUri ?? ""}\u0000${attributeName.localName}`;
    if (expandedAttributes.has(key)) {
      throw new NamespaceError(
        `Attributes on ${JSON.stringify(parsed.name)} contain duplicate expanded name ${JSON.stringify(attributeName.localName)}.`,
      );
    }
    expandedAttributes.add(key);
    attributes.push({ ...attributeName, value });
  }

  const children: XmlNode[] = [];
  for (const child of parsed.children) {
    if (child instanceof ParsedElement) {
      children.push(convertElement(child, bindings));
    } else if (child instanceof ParsedCdata) {
      children.push({ kind: "cdata", value: child.text });
    } else if (child instanceof ParsedText) {
      children.push({ kind: "text", value: child.text });
    } else if (child instanceof ParsedComment) {
      children.push({ kind: "comment", value: child.content });
    } else if (child instanceof ParsedProcessingInstruction) {
      children.push({
        kind: "processing-instruction",
        target: child.name,
        value: child.content,
      });
    }
  }

  return { kind: "element", name, attributes, children };
}

function applyNamespaceDeclaration(
  bindings: Map<string, string>,
  qualifiedName: string,
  namespaceUri: string,
): void {
  if (qualifiedName === "xmlns") {
    if (
      namespaceUri === XML_NAMESPACE_URI ||
      namespaceUri === XMLNS_NAMESPACE_URI
    ) {
      throw new NamespaceError(
        `The default namespace cannot be bound to reserved URI ${JSON.stringify(namespaceUri)}.`,
      );
    }
    if (namespaceUri === "") {
      bindings.delete("");
    } else {
      bindings.set("", namespaceUri);
    }
    return;
  }

  if (!qualifiedName.startsWith("xmlns:")) {
    return;
  }

  const prefix = qualifiedName.slice("xmlns:".length);
  if (!isNcName(prefix) || prefix === "xmlns") {
    throw new NamespaceError(`Invalid namespace declaration ${qualifiedName}.`);
  }
  if (namespaceUri === "") {
    throw new NamespaceError(
      `Namespace prefix ${JSON.stringify(prefix)} cannot be bound to an empty URI.`,
    );
  }
  if (prefix === "xml" && namespaceUri !== XML_NAMESPACE_URI) {
    throw new NamespaceError(
      `The xml prefix must be bound to ${JSON.stringify(XML_NAMESPACE_URI)}.`,
    );
  }
  if (prefix !== "xml" && namespaceUri === XML_NAMESPACE_URI) {
    throw new NamespaceError(
      `Only the xml prefix may be bound to ${JSON.stringify(XML_NAMESPACE_URI)}.`,
    );
  }
  if (namespaceUri === XMLNS_NAMESPACE_URI) {
    throw new NamespaceError(
      `No prefix may be bound to reserved URI ${JSON.stringify(XMLNS_NAMESPACE_URI)}.`,
    );
  }

  bindings.set(prefix, namespaceUri);
}

function expandAttributeName(
  qualifiedName: string,
  bindings: NamespaceBindings,
): XmlExpandedName {
  if (qualifiedName === "xmlns") {
    return {
      qualifiedName,
      prefix: null,
      localName: "xmlns",
      namespaceUri: XMLNS_NAMESPACE_URI,
    };
  }
  if (qualifiedName.startsWith("xmlns:")) {
    return {
      qualifiedName,
      prefix: "xmlns",
      localName: qualifiedName.slice("xmlns:".length),
      namespaceUri: XMLNS_NAMESPACE_URI,
    };
  }
  return expandName(qualifiedName, bindings, false);
}

function expandName(
  qualifiedName: string,
  bindings: NamespaceBindings,
  useDefaultNamespace: boolean,
): XmlExpandedName {
  const parts = qualifiedName.split(":");
  if (
    parts.length > 2 ||
    parts.some((part) => !isNcName(part)) ||
    qualifiedName === "xmlns"
  ) {
    throw new NamespaceError(
      `Invalid namespace-qualified XML name ${JSON.stringify(qualifiedName)}.`,
    );
  }

  const prefix = parts.length === 2 ? (parts[0] ?? null) : null;
  const localName = parts.at(-1);
  if (localName === undefined) {
    throw new NamespaceError(
      `Invalid XML name ${JSON.stringify(qualifiedName)}.`,
    );
  }

  let namespaceUri: string | null = null;
  if (prefix !== null) {
    namespaceUri = bindings.get(prefix) ?? null;
    if (namespaceUri === null) {
      throw new NamespaceError(
        `XML name ${JSON.stringify(qualifiedName)} uses unbound namespace prefix ${JSON.stringify(prefix)}.`,
      );
    }
  } else if (useDefaultNamespace) {
    namespaceUri = bindings.get("") ?? null;
  }

  return { qualifiedName, prefix, localName, namespaceUri };
}

function decodeXml(
  input: string | Uint8Array,
):
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly diagnostic: XmlParseDiagnostic } {
  if (typeof input === "string") {
    return { ok: true, xml: input };
  }

  let encoding: XmlByteEncoding = "utf-8";
  let offset = 0;
  if (startsWith(input, [0xef, 0xbb, 0xbf])) {
    offset = 3;
  } else if (startsWith(input, [0xff, 0xfe])) {
    encoding = "utf-16le";
    offset = 2;
  } else if (startsWith(input, [0xfe, 0xff])) {
    encoding = "utf-16be";
    offset = 2;
  } else if (startsWith(input, [0x3c, 0x00, 0x3f, 0x00])) {
    encoding = "utf-16le";
  } else if (startsWith(input, [0x00, 0x3c, 0x00, 0x3f])) {
    encoding = "utf-16be";
  }

  try {
    const xml = new TextDecoder(encoding, { fatal: true }).decode(
      input.subarray(offset),
    );
    const declarationFailure = validateEncodingDeclaration(xml, encoding);
    return declarationFailure ?? { ok: true, xml };
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        code: "unsupported-encoding",
        message: `XML bytes could not be decoded as ${encoding}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }
}

function validateEncodingDeclaration(
  xml: string,
  actualEncoding: XmlByteEncoding,
): { readonly ok: false; readonly diagnostic: XmlParseDiagnostic } | undefined {
  if (!xml.startsWith("<?xml")) return undefined;

  const declarationEnd = xml.indexOf("?>");
  if (declarationEnd === -1) return undefined;

  const declaration = xml.slice(0, declarationEnd + 2);
  const match =
    /(?:^|[\t\n\r ])encoding[\t\n\r ]*=[\t\n\r ]*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/u.exec(
      declaration,
    );
  const declaredEncoding = match?.[2]?.toLowerCase();
  if (declaredEncoding === undefined) return undefined;

  const compatible =
    (declaredEncoding === "utf-8" && actualEncoding === "utf-8") ||
    (declaredEncoding === "utf-16" && actualEncoding !== "utf-8") ||
    declaredEncoding === actualEncoding;
  if (compatible) return undefined;

  const supported = ["utf-8", "utf-16", "utf-16be", "utf-16le"].includes(
    declaredEncoding,
  );
  return {
    ok: false,
    diagnostic: {
      code: "unsupported-encoding",
      message: supported
        ? `XML declares ${JSON.stringify(declaredEncoding)} but its bytes are ${actualEncoding}.`
        : `XML declares unsupported encoding ${JSON.stringify(declaredEncoding)}.`,
    },
  };
}

function isNcName(value: string): boolean {
  let first = true;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      (first ? !isNcNameStart(codePoint) : !isNcNameCharacter(codePoint))
    ) {
      return false;
    }
    first = false;
  }
  return !first;
}

function isNcNameStart(codePoint: number): boolean {
  return (
    codePoint === 0x5f ||
    isInRange(codePoint, 0x41, 0x5a) ||
    isInRange(codePoint, 0x61, 0x7a) ||
    isInRange(codePoint, 0xc0, 0xd6) ||
    isInRange(codePoint, 0xd8, 0xf6) ||
    isInRange(codePoint, 0xf8, 0x2ff) ||
    isInRange(codePoint, 0x370, 0x37d) ||
    isInRange(codePoint, 0x37f, 0x1fff) ||
    isInRange(codePoint, 0x200c, 0x200d) ||
    isInRange(codePoint, 0x2070, 0x218f) ||
    isInRange(codePoint, 0x2c00, 0x2fef) ||
    isInRange(codePoint, 0x3001, 0xd7ff) ||
    isInRange(codePoint, 0xf900, 0xfdcf) ||
    isInRange(codePoint, 0xfdf0, 0xfffd) ||
    isInRange(codePoint, 0x10000, 0xeffff)
  );
}

function isNcNameCharacter(codePoint: number): boolean {
  return (
    isNcNameStart(codePoint) ||
    codePoint === 0x2d ||
    codePoint === 0x2e ||
    codePoint === 0xb7 ||
    isInRange(codePoint, 0x30, 0x39) ||
    isInRange(codePoint, 0x300, 0x36f) ||
    isInRange(codePoint, 0x203f, 0x2040)
  );
}

function isInRange(value: number, minimum: number, maximum: number): boolean {
  return value >= minimum && value <= maximum;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function findDocumentTypeOffset(xml: string): number {
  for (let offset = 0; offset < xml.length; offset += 1) {
    if (xml.startsWith("<!--", offset)) {
      const end = xml.indexOf("-->", offset + 4);
      if (end === -1) return -1;
      offset = end + 2;
    } else if (xml.startsWith("<![CDATA[", offset)) {
      const end = xml.indexOf("]]>", offset + 9);
      if (end === -1) return -1;
      offset = end + 2;
    } else if (xml.startsWith("<?", offset)) {
      const end = xml.indexOf("?>", offset + 2);
      if (end === -1) return -1;
      offset = end + 1;
    } else if (xml.startsWith("<!DOCTYPE", offset)) {
      return offset;
    }
  }
  return -1;
}

function positionAt(
  xml: string,
  offset: number,
): Pick<XmlParseDiagnostic, "column" | "line" | "offset"> {
  const before = xml.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
    offset: Math.max(0, offset),
  };
}

function malformed(message: string): {
  readonly ok: false;
  readonly diagnostic: XmlParseDiagnostic;
} {
  return {
    ok: false,
    diagnostic: { code: "malformed-xml", message },
  };
}
