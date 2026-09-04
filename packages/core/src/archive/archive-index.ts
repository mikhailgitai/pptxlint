import type { ContextDiagnostic } from "../context/types.js";
import {
  canonicalizeEntryPartName,
  partNameComparisonKey,
} from "../opc/path.js";
import type { ZipArchive, ZipEntryDescriptor } from "./types.js";

export interface ArchiveSecurityLimits {
  readonly maxEntries: number;
  readonly maxPartUncompressedBytes: number;
  readonly maxXmlUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxCompressionRatio: number;
}

export const HARD_ARCHIVE_SECURITY_LIMITS: ArchiveSecurityLimits = {
  maxEntries: 10_000,
  maxPartUncompressedBytes: 256 * 1024 * 1024,
  maxXmlUncompressedBytes: 20 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export const DEFAULT_ARCHIVE_SECURITY_LIMITS: ArchiveSecurityLimits = {
  ...HARD_ARCHIVE_SECURITY_LIMITS,
};

export interface ArchiveEntryDescriptor {
  readonly name: string;
  readonly rawName: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
}

export type ArchiveReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly code:
        | "ambiguous-part-name"
        | "entry-read-failed"
        | "part-limit-exceeded"
        | "part-not-found";
      readonly message: string;
    };

export interface ArchiveIndexStats {
  readonly entryReads: number;
}

export interface ArchiveIndex {
  list(): readonly ArchiveEntryDescriptor[];
  has(partName: string): boolean;
  isXmlPart(partName: string): boolean;
  registerXmlParts(partNames: readonly string[]): void;
  read(partName: string): Promise<ArchiveReadResult>;
  duplicates(): readonly string[];
  readonly stats: ArchiveIndexStats;
  close(): Promise<void>;
}

export interface ArchiveIndexResult {
  readonly index: ArchiveIndex;
  readonly diagnostics: readonly ContextDiagnostic[];
}

export function resolveArchiveSecurityLimits(
  overrides: Partial<ArchiveSecurityLimits> | undefined,
): ArchiveSecurityLimits {
  const candidate: unknown = overrides;
  if (
    candidate !== undefined &&
    (typeof candidate !== "object" || candidate === null)
  ) {
    throw new TypeError("archiveLimits must be an object.");
  }
  const validatedOverrides = candidate as
    Partial<ArchiveSecurityLimits> | undefined;
  const resolved = { ...DEFAULT_ARCHIVE_SECURITY_LIMITS };
  for (const name of Object.keys(
    HARD_ARCHIVE_SECURITY_LIMITS,
  ) as (keyof ArchiveSecurityLimits)[]) {
    if (
      validatedOverrides !== undefined &&
      Object.hasOwn(validatedOverrides, name)
    ) {
      const value = validatedOverrides[name];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        (name !== "maxCompressionRatio" && !Number.isInteger(value))
      ) {
        throw new TypeError(
          `${name} must be a finite positive ${name === "maxCompressionRatio" ? "number" : "integer"}.`,
        );
      }
      if (value > HARD_ARCHIVE_SECURITY_LIMITS[name]) {
        throw new RangeError(
          `${name} cannot exceed the hard ceiling ${String(HARD_ARCHIVE_SECURITY_LIMITS[name])}.`,
        );
      }
      resolved[name] = value;
    }
  }
  return resolved;
}

export function createArchiveIndex(
  archive: ZipArchive,
  limits: ArchiveSecurityLimits = DEFAULT_ARCHIVE_SECURITY_LIMITS,
): ArchiveIndexResult {
  limits = resolveArchiveSecurityLimits(limits);
  const diagnostics: ContextDiagnostic[] = [];
  const descriptors: ArchiveEntryDescriptor[] = [];
  const nativeByName = new Map<string, ZipEntryDescriptor[]>();
  const denied = new Map<string, string>();
  const xmlParts = new Set<string>();
  let totalSize = 0;
  let individuallyDenied = 0;
  const entryCountExceeded = archive.entries.length > limits.maxEntries;

  if (entryCountExceeded) {
    diagnostics.push(
      diagnostic(
        "archive-limit-exceeded",
        `Archive has ${String(archive.entries.length)} entries; limit is ${String(limits.maxEntries)}.`,
      ),
    );
  }

  for (const entry of archive.entries) {
    if (entry.directory) continue;
    const canonical = canonicalizeEntryPartName(entry.name);
    if (!canonical.ok) {
      diagnostics.push(
        diagnostic(
          "invalid-part-name",
          `${JSON.stringify(entry.name)}: ${canonical.message}`,
        ),
      );
      continue;
    }

    const name = canonical.partName;
    const key = partNameComparisonKey(name);
    if (isXmlPartName(key)) xmlParts.add(key);
    descriptors.push({
      name,
      rawName: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      crc32: entry.crc32,
    });
    const entries = nativeByName.get(key) ?? [];
    entries.push(entry);
    nativeByName.set(key, entries);
    totalSize += entry.uncompressedSize;

    const ratio =
      entry.compressedSize === 0
        ? entry.uncompressedSize === 0
          ? 1
          : Number.POSITIVE_INFINITY
        : entry.uncompressedSize / entry.compressedSize;
    if (entry.uncompressedSize > limits.maxPartUncompressedBytes) {
      denied.set(key, "Part exceeds the uncompressed-size limit.");
      individuallyDenied += 1;
    } else if (
      xmlParts.has(key) &&
      entry.uncompressedSize > limits.maxXmlUncompressedBytes
    ) {
      denied.set(key, "XML part exceeds the uncompressed-size limit.");
      individuallyDenied += 1;
    } else if (ratio > limits.maxCompressionRatio) {
      denied.set(key, "Part exceeds the compression-ratio limit.");
      individuallyDenied += 1;
    }
  }

  if (individuallyDenied > 0) {
    diagnostics.push(
      diagnostic(
        "archive-limit-exceeded",
        `${String(individuallyDenied)} package part(s) exceed individual size or compression-ratio limits.`,
      ),
    );
  }

  if (entryCountExceeded) {
    for (const name of nativeByName.keys()) {
      denied.set(name, "Archive exceeds the entry-count limit.");
    }
  }

  if (totalSize > limits.maxTotalUncompressedBytes) {
    diagnostics.push(
      diagnostic(
        "archive-limit-exceeded",
        `Archive declares ${String(totalSize)} uncompressed bytes; limit is ${String(limits.maxTotalUncompressedBytes)}.`,
      ),
    );
    for (const name of nativeByName.keys()) {
      denied.set(name, "Archive exceeds the total uncompressed-size limit.");
    }
  }

  const duplicates = [...nativeByName]
    .filter(([, entries]) => entries.length > 1)
    .map(([name]) => name)
    .sort();
  for (const name of duplicates) {
    diagnostics.push(
      diagnostic(
        "ambiguous-part-name",
        `Multiple ZIP entries resolve to canonical part ${JSON.stringify(name)}.`,
        name,
      ),
    );
  }

  const reads = new Map<string, Promise<ArchiveReadResult>>();
  let entryReads = 0;
  const index: ArchiveIndex = {
    list: () => descriptors,
    has: (partName) =>
      nativeByName.get(partNameComparisonKey(partName))?.length === 1,
    isXmlPart: (partName) => xmlParts.has(partNameComparisonKey(partName)),
    registerXmlParts(partNames) {
      let newlyDenied = 0;
      for (const partName of partNames) {
        const key = partNameComparisonKey(partName);
        xmlParts.add(key);
        const entries = nativeByName.get(key) ?? [];
        if (
          !denied.has(key) &&
          entries.some(
            (entry) => entry.uncompressedSize > limits.maxXmlUncompressedBytes,
          )
        ) {
          denied.set(key, "XML part exceeds the uncompressed-size limit.");
          newlyDenied += 1;
        }
      }
      if (newlyDenied > 0) {
        diagnostics.push(
          diagnostic(
            "archive-limit-exceeded",
            `${String(newlyDenied)} content-type-designated XML part(s) exceed the XML size limit.`,
          ),
        );
      }
    },
    duplicates: () => duplicates,
    get stats() {
      return { entryReads };
    },
    read(partName) {
      const key = partNameComparisonKey(partName);
      const existing = reads.get(key);
      if (existing !== undefined) return existing;
      const entries = nativeByName.get(key);
      let read: Promise<ArchiveReadResult>;
      if (entries === undefined) {
        read = Promise.resolve({
          ok: false,
          code: "part-not-found",
          message: `Package part ${JSON.stringify(partName)} does not exist.`,
        });
      } else if (entries.length !== 1) {
        read = Promise.resolve({
          ok: false,
          code: "ambiguous-part-name",
          message: `Package part ${JSON.stringify(partName)} is ambiguous.`,
        });
      } else if (denied.has(key)) {
        read = Promise.resolve({
          ok: false,
          code: "part-limit-exceeded",
          message: denied.get(key) ?? "Part is blocked by archive limits.",
        });
      } else {
        entryReads += 1;
        read = readSingleEntry(
          entries,
          xmlParts.has(key)
            ? Math.min(
                limits.maxPartUncompressedBytes,
                limits.maxXmlUncompressedBytes,
              )
            : limits.maxPartUncompressedBytes,
        );
      }
      reads.set(key, read);
      return read;
    },
    close: () => archive.close(),
  };
  return { index, diagnostics };
}

function readSingleEntry(
  entries: readonly ZipEntryDescriptor[],
  maximumBytes: number,
): Promise<ArchiveReadResult> {
  const entry = entries[0];
  return entry === undefined
    ? Promise.resolve({
        ok: false,
        code: "entry-read-failed",
        message: "Indexed package part has no ZIP entry.",
      })
    : readEntry(entry, maximumBytes);
}

async function readEntry(
  entry: ZipEntryDescriptor,
  maximumBytes: number,
): Promise<ArchiveReadResult> {
  const result = await entry.read(maximumBytes);
  if (!result.ok) {
    return {
      ok: false,
      code:
        result.diagnostic.code === "actual-size-limit-exceeded"
          ? "part-limit-exceeded"
          : "entry-read-failed",
      message: result.diagnostic.message,
    };
  }
  return result.bytes.byteLength <= maximumBytes
    ? result
    : {
        ok: false,
        code: "part-limit-exceeded",
        message: "Actual uncompressed part bytes exceed the security limit.",
      };
}

function isXmlPartName(comparisonKey: string): boolean {
  return comparisonKey.endsWith(".xml") || comparisonKey.endsWith(".rels");
}

function diagnostic(
  code: ContextDiagnostic["code"],
  message: string,
  partName: string | null = null,
): ContextDiagnostic {
  return { code, message, partName, relationshipId: null };
}
