import type { ArchiveIndex } from "../archive/archive-index.js";
import { partNameComparisonKey } from "../opc/path.js";
import { parseXml } from "./xml-parser.js";
import type { XmlDocument, XmlParseDiagnosticCode } from "./types.js";

export interface XmlPartDiagnostic {
  readonly code:
    | XmlParseDiagnosticCode
    | "ambiguous-part-name"
    | "entry-read-failed"
    | "part-limit-exceeded"
    | "part-not-found";
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;
}

export type XmlPartResult =
  | { readonly ok: true; readonly document: XmlDocument }
  | { readonly ok: false; readonly diagnostic: XmlPartDiagnostic };

export interface XmlPartStoreStats {
  readonly parseAttempts: number;
}

export interface XmlPartStore {
  get(partName: string): Promise<XmlPartResult>;
  knownXmlParts(): readonly string[];
  readonly stats: XmlPartStoreStats;
}

export function createXmlPartStore(archive: ArchiveIndex): XmlPartStore {
  const cache = new Map<string, Promise<XmlPartResult>>();
  let parseAttempts = 0;
  return {
    get(partName) {
      const key = partNameComparisonKey(partName);
      const existing = cache.get(key);
      if (existing !== undefined) return existing;
      const result = (async (): Promise<XmlPartResult> => {
        const read = await archive.read(partName);
        if (!read.ok) {
          return {
            ok: false,
            diagnostic: { code: read.code, message: read.message },
          };
        }
        parseAttempts += 1;
        return parseXml(read.bytes);
      })();
      cache.set(key, result);
      return result;
    },
    knownXmlParts: () =>
      archive
        .list()
        .map((entry) => entry.name)
        .filter((name) => archive.isXmlPart(name))
        .sort(),
    get stats() {
      return { parseAttempts };
    },
  };
}
