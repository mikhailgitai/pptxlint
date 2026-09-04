const UTF8_FLAG = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
const STORED_COMPRESSION = 0;
const DOS_TIME = 0;
const DOS_DATE_1980_01_01 = 0x0021;

export interface RawZipEntry {
  readonly name: string;
  readonly data: string | Uint8Array;
  /** Creates a central/local header mismatch for negative fixtures. */
  readonly localHeaderName?: string;
  /** Writes an intentionally incorrect checksum when provided. */
  readonly crc32Override?: number;
  /** Forges only the central-directory uncompressed size. */
  readonly declaredUncompressedSizeOverride?: number;
}

export interface RawZipOptions {
  /** Removes bytes from the end after building the archive. */
  readonly truncateEndBytes?: number;
  /** Overrides both legacy EOCD entry counts for ambiguous ZIP fixtures. */
  readonly eocdEntryCountOverride?: number;
  /** Uses ZIP64 end records even when fixture sizes fit legacy fields. */
  readonly forceZip64?: boolean;
}

interface PreparedEntry {
  readonly name: Uint8Array;
  readonly data: Uint8Array;
  readonly crc32: number;
  readonly localHeaderOffset: number;
  readonly declaredUncompressedSize: number;
}

/**
 * Small deterministic ZIP writer for fixtures. It deliberately permits
 * duplicates and contradictory headers so invalid archives remain reviewable.
 */
export function buildRawZip(
  entries: readonly RawZipEntry[],
  options: RawZipOptions = {},
): Uint8Array {
  if (entries.length > 0xffff) {
    throw new RangeError("Raw ZIP fixture supports at most 65,535 entries.");
  }

  const localRecords: Uint8Array[] = [];
  const preparedEntries: PreparedEntry[] = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const name = encode(entry.name);
    const localName = encode(entry.localHeaderName ?? entry.name);
    const data =
      typeof entry.data === "string" ? encode(entry.data) : entry.data;
    assertUint32(
      data.byteLength,
      `Entry ${JSON.stringify(entry.name)} is too large`,
    );

    const crc32 = (entry.crc32Override ?? calculateCrc32(data)) >>> 0;
    const localHeader = new Uint8Array(30 + localName.byteLength);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, STORED_COMPRESSION, true);
    view.setUint16(10, DOS_TIME, true);
    view.setUint16(12, DOS_DATE_1980_01_01, true);
    view.setUint32(14, crc32, true);
    view.setUint32(18, data.byteLength, true);
    view.setUint32(22, data.byteLength, true);
    view.setUint16(26, localName.byteLength, true);
    view.setUint16(28, 0, true);
    localHeader.set(localName, 30);

    localRecords.push(localHeader, data);
    const declaredUncompressedSize =
      entry.declaredUncompressedSizeOverride ?? data.byteLength;
    assertUint32(
      declaredUncompressedSize,
      `Declared size for ${JSON.stringify(entry.name)} is too large`,
    );
    preparedEntries.push({
      name,
      data,
      crc32,
      localHeaderOffset,
      declaredUncompressedSize,
    });
    localHeaderOffset += localHeader.byteLength + data.byteLength;
    assertUint32(localHeaderOffset, "Raw ZIP local records are too large");
  }

  const centralRecords = preparedEntries.map((entry) => {
    const centralHeader = new Uint8Array(46 + entry.name.byteLength);
    const view = new DataView(centralHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, VERSION_MADE_BY, true);
    view.setUint16(6, VERSION_NEEDED, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, STORED_COMPRESSION, true);
    view.setUint16(12, DOS_TIME, true);
    view.setUint16(14, DOS_DATE_1980_01_01, true);
    view.setUint32(16, entry.crc32, true);
    view.setUint32(20, entry.data.byteLength, true);
    view.setUint32(24, entry.declaredUncompressedSize, true);
    view.setUint16(28, entry.name.byteLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.localHeaderOffset, true);
    centralHeader.set(entry.name, 46);
    return centralHeader;
  });

  const centralDirectorySize = centralRecords.reduce(
    (total, record) => total + record.byteLength,
    0,
  );
  assertUint32(centralDirectorySize, "Raw ZIP central directory is too large");

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  const forceZip64 = options.forceZip64 ?? false;
  if (forceZip64 && options.eocdEntryCountOverride !== undefined) {
    throw new RangeError(
      "forceZip64 and eocdEntryCountOverride cannot be combined.",
    );
  }
  const eocdEntryCount = options.eocdEntryCountOverride ?? entries.length;
  if (
    !Number.isInteger(eocdEntryCount) ||
    eocdEntryCount < 0 ||
    eocdEntryCount > 0xffff
  ) {
    throw new RangeError(
      "EOCD entry count must fit in an unsigned 16-bit field.",
    );
  }
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, forceZip64 ? 0xffff : eocdEntryCount, true);
  endView.setUint16(10, forceZip64 ? 0xffff : eocdEntryCount, true);
  endView.setUint32(12, forceZip64 ? 0xffffffff : centralDirectorySize, true);
  endView.setUint32(16, forceZip64 ? 0xffffffff : localHeaderOffset, true);
  endView.setUint16(20, 0, true);

  const trailers = forceZip64
    ? buildZip64Trailers(
        entries.length,
        centralDirectorySize,
        localHeaderOffset,
      )
    : [];
  const archive = concatenate([
    ...localRecords,
    ...centralRecords,
    ...trailers,
    end,
  ]);
  const truncateEndBytes = options.truncateEndBytes ?? 0;
  if (truncateEndBytes < 0 || truncateEndBytes > archive.byteLength) {
    throw new RangeError("truncateEndBytes is outside the generated ZIP.");
  }

  return archive.slice(0, archive.byteLength - truncateEndBytes);
}

function buildZip64Trailers(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): readonly Uint8Array[] {
  const end = new Uint8Array(56);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06064b50, true);
  endView.setBigUint64(4, 44n, true);
  endView.setUint16(12, 45, true);
  endView.setUint16(14, 45, true);
  endView.setBigUint64(24, BigInt(entryCount), true);
  endView.setBigUint64(32, BigInt(entryCount), true);
  endView.setBigUint64(40, BigInt(centralDirectorySize), true);
  endView.setBigUint64(48, BigInt(centralDirectoryOffset), true);

  const locator = new Uint8Array(20);
  const locatorView = new DataView(locator.buffer);
  locatorView.setUint32(0, 0x07064b50, true);
  locatorView.setBigUint64(
    8,
    BigInt(centralDirectoryOffset + centralDirectorySize),
    true,
  );
  locatorView.setUint32(16, 1, true);
  return [end, locator];
}

function encode(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > 0xffff) {
    throw new RangeError("Raw ZIP entry name is longer than 65,535 bytes.");
  }
  return bytes;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function assertUint32(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(message);
  }
}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const tableIndex = (crc ^ byte) & 0xff;
    crc = (CRC32_TABLE[tableIndex] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
