import type { ContextDiagnostic } from "../context/types.js";
import {
  canonicalizeEntryPartName,
  partNameComparisonKey,
} from "../opc/path.js";
import { childElements, getAttribute } from "../xml/query.js";
import type { XmlPartStore } from "../xml/xml-part-store.js";

export const CONTENT_TYPES_PART = "[Content_Types].xml";
export const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
export const VML_DRAWING_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.vmlDrawing";

export interface ContentTypeIndex {
  readonly defaults: ReadonlyMap<string, string>;
  readonly overrides: ReadonlyMap<string, string>;
  get(partName: string): string | null;
  isXml(partName: string): boolean;
}

export interface ContentTypeIndexResult {
  readonly index: ContentTypeIndex;
  readonly diagnostics: readonly ContextDiagnostic[];
}

export async function buildContentTypeIndex(
  xml: XmlPartStore,
): Promise<ContentTypeIndexResult> {
  const diagnostics: ContextDiagnostic[] = [];
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const parsed = await xml.get(CONTENT_TYPES_PART);

  if (!parsed.ok) {
    diagnostics.push({
      code:
        parsed.diagnostic.code === "part-not-found"
          ? "missing-content-types"
          : "invalid-content-types",
      message: parsed.diagnostic.message,
      partName: CONTENT_TYPES_PART,
      relationshipId: null,
    });
    if (
      parsed.diagnostic.code === "malformed-xml" ||
      parsed.diagnostic.code === "dtd-prohibited" ||
      parsed.diagnostic.code === "invalid-namespace" ||
      parsed.diagnostic.code === "unsupported-encoding"
    ) {
      diagnostics.push({
        code: "malformed-xml",
        message: parsed.diagnostic.message,
        partName: CONTENT_TYPES_PART,
        relationshipId: null,
      });
    }
    return { index: createIndex(defaults, overrides), diagnostics };
  }

  const root = parsed.document.root;
  if (
    root.name.namespaceUri !== CONTENT_TYPES_NAMESPACE ||
    root.name.localName !== "Types"
  ) {
    diagnostics.push({
      code: "invalid-content-types",
      message: "Content types part has an unexpected root element.",
      partName: CONTENT_TYPES_PART,
      relationshipId: null,
    });
    return { index: createIndex(defaults, overrides), diagnostics };
  }

  for (const element of childElements(root)) {
    if (element.name.namespaceUri !== CONTENT_TYPES_NAMESPACE) continue;
    if (element.name.localName === "Default") {
      const extension = getAttribute(element, null, "Extension")?.value;
      const contentType = getAttribute(element, null, "ContentType")?.value;
      if (!hasValue(extension) || !hasValue(contentType)) {
        invalidDeclaration(
          diagnostics,
          "Default requires non-empty Extension and ContentType attributes.",
        );
        continue;
      }
      insert(
        defaults,
        partNameComparisonKey(extension),
        contentType,
        diagnostics,
      );
    } else if (element.name.localName === "Override") {
      const rawPartName = getAttribute(element, null, "PartName")?.value;
      const contentType = getAttribute(element, null, "ContentType")?.value;
      if (!hasValue(rawPartName) || !hasValue(contentType)) {
        invalidDeclaration(
          diagnostics,
          "Override requires non-empty PartName and ContentType attributes.",
        );
        continue;
      }
      const canonical = canonicalizeEntryPartName(
        rawPartName.startsWith("/") ? rawPartName.slice(1) : rawPartName,
      );
      if (!canonical.ok) {
        diagnostics.push({
          code: "invalid-content-types",
          message: `Invalid Override PartName ${JSON.stringify(rawPartName)}: ${canonical.message}`,
          partName: CONTENT_TYPES_PART,
          relationshipId: null,
        });
        continue;
      }
      insert(
        overrides,
        partNameComparisonKey(canonical.partName),
        contentType,
        diagnostics,
      );
    }
  }
  return { index: createIndex(defaults, overrides), diagnostics };
}

function createIndex(
  defaults: ReadonlyMap<string, string>,
  overrides: ReadonlyMap<string, string>,
): ContentTypeIndex {
  const get = (partName: string): string | null => {
    const override = overrides.get(partNameComparisonKey(partName));
    if (override !== undefined) return override;
    const fileName = partName.slice(partName.lastIndexOf("/") + 1);
    const dot = fileName.lastIndexOf(".");
    return dot === -1
      ? null
      : (defaults.get(partNameComparisonKey(fileName.slice(dot + 1))) ?? null);
  };
  return {
    defaults,
    overrides,
    get,
    isXml(partName) {
      const contentType = get(partName);
      const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
      return (
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType === VML_DRAWING_CONTENT_TYPE.toLowerCase() ||
        mediaType?.endsWith("+xml") === true
      );
    },
  };
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function invalidDeclaration(
  diagnostics: ContextDiagnostic[],
  message: string,
): void {
  diagnostics.push({
    code: "invalid-content-types",
    message,
    partName: CONTENT_TYPES_PART,
    relationshipId: null,
  });
}

function insert(
  map: Map<string, string>,
  key: string,
  value: string,
  diagnostics: ContextDiagnostic[],
): void {
  if (map.has(key)) {
    diagnostics.push({
      code: "duplicate-content-type",
      message: `Content type key ${JSON.stringify(key)} is declared more than once.`,
      partName: CONTENT_TYPES_PART,
      relationshipId: null,
    });
  } else {
    map.set(key, value);
  }
}
