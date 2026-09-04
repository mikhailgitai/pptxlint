import { Uint8ArrayReader, Writer, ZipReader } from "@zip.js/zip.js";
import type { Entry } from "@zip.js/zip.js";

import type {
  ZipArchive,
  ZipDiagnostic,
  ZipEntryDescriptor,
  ZipEntryReadResult,
  ZipOpenResult,
} from "./types.js";
import { validateZipStructure } from "./zip-structure.js";

const READER_OPTIONS = {
  checkAmbiguity: false,
  checkOverlappingEntry: true,
  checkSignature: true,
  useWebWorkers: false,
} as const;

/**
 * Opens ZIP bytes without extracting entry payloads.
 *
 * Duplicate central-directory names remain separate entries. Strict duplicate
 * rejection is intentionally deferred to the package policy layer in PR 03.
 */
export async function openZipArchive(
  bytes: Uint8Array,
): Promise<ZipOpenResult> {
  let expectedEntryCount: number;
  try {
    expectedEntryCount = validateZipStructure(bytes);
  } catch (error) {
    return failure("invalid-zip", error);
  }

  const reader = new ZipReader(new Uint8ArrayReader(bytes), READER_OPTIONS);

  let nativeEntries: Entry[];
  try {
    nativeEntries = await reader.getEntries({ checkAmbiguity: false });
  } catch (error) {
    await safelyClose(reader);
    return failure("invalid-zip", error);
  }
  if (nativeEntries.length !== expectedEntryCount) {
    await safelyClose(reader);
    return failure(
      "invalid-zip",
      new Error(
        `ZIP reader returned ${String(nativeEntries.length)} entries; ${String(expectedEntryCount)} were validated.`,
      ),
    );
  }

  let closed = false;
  const entries = nativeEntries.map((entry, index) => {
    const cachedReads = new Map<number, Promise<ZipEntryReadResult>>();

    const descriptor: ZipEntryDescriptor = {
      index,
      name: entry.filename,
      rawName: new Uint8Array(entry.rawFilename),
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      crc32: entry.signature,
      compressionMethod: entry.compressionMethod,
      directory: entry.directory,
      encrypted: entry.encrypted,
      read(maximumBytes = entry.uncompressedSize) {
        if (closed) {
          return Promise.resolve({
            ok: false,
            diagnostic: {
              code: "archive-closed",
              message: `Cannot read ZIP entry ${JSON.stringify(entry.filename)} after the archive was closed.`,
            },
          });
        }

        if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
          return Promise.resolve({
            ok: false,
            diagnostic: {
              code: "actual-size-limit-exceeded",
              message:
                "ZIP entry read limit must be a non-negative safe integer.",
            },
          });
        }
        const effectiveLimit = Math.min(maximumBytes, entry.uncompressedSize);
        let cachedRead = cachedReads.get(effectiveLimit);
        if (cachedRead === undefined) {
          cachedRead = readEntry(entry, effectiveLimit);
          cachedReads.set(effectiveLimit, cachedRead);
        }
        return cachedRead;
      },
    };

    return descriptor;
  });

  const archive: ZipArchive = {
    entries,
    duplicateNames: findDuplicateNames(entries),
    async close() {
      if (!closed) {
        closed = true;
        await safelyClose(reader);
      }
    },
  };

  return { ok: true, archive };
}

async function readEntry(
  entry: Entry,
  maximumBytes: number,
): Promise<ZipEntryReadResult> {
  if (entry.directory) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const outputWriter = new BoundedUint8ArrayWriter(maximumBytes);
  try {
    const bytes = await entry.getData<Uint8Array>(outputWriter, {
      checkAmbiguity: true,
      checkOverlappingEntry: true,
      checkSignature: true,
      useWebWorkers: false,
    });
    if (bytes.byteLength !== entry.uncompressedSize) {
      return failure(
        "entry-size-mismatch",
        new Error(
          `ZIP entry ${JSON.stringify(entry.filename)} produced ${String(bytes.byteLength)} bytes; the central directory declares ${String(entry.uncompressedSize)}.`,
        ),
      );
    }
    return { ok: true, bytes };
  } catch (error) {
    if (outputWriter.limitExceeded) {
      return failure(
        "actual-size-limit-exceeded",
        new ActualSizeLimitError(maximumBytes),
      );
    }
    if (error instanceof ActualSizeLimitError) {
      return failure("actual-size-limit-exceeded", error);
    }
    return failure("entry-read-failed", error);
  }
}

class ActualSizeLimitError extends Error {
  public constructor(maximumBytes: number) {
    super(
      `Actual uncompressed ZIP entry bytes exceed the ${String(maximumBytes)} byte limit.`,
    );
    this.name = "ActualSizeLimitError";
  }
}

/** Writes decompressed bytes into one buffer sized from validated ZIP metadata. */
class BoundedUint8ArrayWriter extends Writer<Uint8Array> {
  readonly #maximumBytes: number;
  #buffer: Uint8Array | null = null;
  #length = 0;
  #limitExceeded = false;

  public constructor(maximumBytes: number) {
    super();
    this.#maximumBytes = maximumBytes;
  }

  public override async init(declaredBytes = 0): Promise<void> {
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > this.#maximumBytes
    ) {
      this.#limitExceeded = true;
      throw new ActualSizeLimitError(this.#maximumBytes);
    }
    this.#buffer = new Uint8Array(declaredBytes);
    this.#length = 0;
    this.#limitExceeded = false;
    await super.init?.();
  }

  public get limitExceeded(): boolean {
    return this.#limitExceeded;
  }

  public override writeUint8Array(array: Uint8Array): Promise<void> {
    const buffer = this.#buffer;
    if (
      buffer === null ||
      array.byteLength > buffer.byteLength - this.#length
    ) {
      this.#limitExceeded = true;
      throw new ActualSizeLimitError(this.#maximumBytes);
    }
    buffer.set(array, this.#length);
    this.#length += array.byteLength;
    return Promise.resolve();
  }

  public override getData(): Promise<Uint8Array> {
    const buffer = this.#buffer;
    if (buffer === null) {
      return Promise.reject(new Error("ZIP entry writer is not initialized."));
    }
    return Promise.resolve(buffer.subarray(0, this.#length));
  }
}

function findDuplicateNames(
  entries: readonly ZipEntryDescriptor[],
): readonly string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }

  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

function failure(
  code: ZipDiagnostic["code"],
  error: unknown,
): { readonly ok: false; readonly diagnostic: ZipDiagnostic } {
  return {
    ok: false,
    diagnostic: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function safelyClose(reader: ZipReader<Uint8Array>): Promise<void> {
  try {
    await reader.close();
  } catch {
    // The original open/read diagnostic is more useful than a close error.
  }
}
