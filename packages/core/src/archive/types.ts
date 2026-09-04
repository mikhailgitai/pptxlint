export type ZipDiagnosticCode =
  | "actual-size-limit-exceeded"
  | "archive-closed"
  | "entry-read-failed"
  | "entry-size-mismatch"
  | "invalid-zip";

export interface ZipDiagnostic {
  readonly code: ZipDiagnosticCode;
  readonly message: string;
}

export type ZipEntryReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly diagnostic: ZipDiagnostic };

/** Metadata comes from the central directory. Entry data is read only on demand. */
export interface ZipEntryDescriptor {
  readonly index: number;
  readonly name: string;
  readonly rawName: Uint8Array;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly compressionMethod: number;
  readonly directory: boolean;
  readonly encrypted: boolean;
  /**
   * Reads the entry through a bounded writer. The adapter also treats the
   * central-directory uncompressed size as a ceiling, so forged metadata
   * cannot make decompression allocate an unbounded output buffer.
   */
  read(maximumBytes?: number): Promise<ZipEntryReadResult>;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntryDescriptor[];
  /** Sorted decoded names that occur more than once in the central directory. */
  readonly duplicateNames: readonly string[];
  close(): Promise<void>;
}

export type ZipOpenResult =
  | { readonly ok: true; readonly archive: ZipArchive }
  | { readonly ok: false; readonly diagnostic: ZipDiagnostic };
