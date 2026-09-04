const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_DIRECTORY_DIGITAL_SIGNATURE = 0x05054b50;
const ARCHIVE_EXTRA_DATA_SIGNATURE = 0x08064b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;

const CENTRAL_FILE_HEADER_LENGTH = 46;
const END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH = 56;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_LENGTH = 20;

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

interface CentralDirectoryInfo {
  readonly offset: number;
  readonly size: number;
  readonly entryCount: number;
  readonly trailerOffset: number;
}

/**
 * Checks central-directory boundaries and counts without rejecting duplicate
 * filenames. This covers archive ambiguities that zip.js couples to its own
 * duplicate-name rejection behind `checkAmbiguity`.
 */
export function validateZipStructure(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const info = readCentralDirectoryInfo(view, endOffset);

  if (info.offset + info.size !== info.trailerOffset) {
    throw new Error(
      "ZIP central directory boundaries do not match its end record.",
    );
  }

  const actualEntryCount = countCentralDirectoryEntries(
    view,
    info.offset,
    info.size,
  );
  if (actualEntryCount !== info.entryCount) {
    throw new Error(
      `ZIP central directory declares ${String(info.entryCount)} entries but contains ${String(actualEntryCount)}.`,
    );
  }

  return actualEntryCount;
}

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < END_OF_CENTRAL_DIRECTORY_LENGTH) {
    throw new Error("ZIP end of central directory record was not found.");
  }

  const firstCandidate = Math.max(
    0,
    view.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH - UINT16_MAX,
  );
  for (
    let offset = view.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH;
    offset >= firstCandidate;
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE &&
      offset +
        END_OF_CENTRAL_DIRECTORY_LENGTH +
        view.getUint16(offset + 20, true) ===
        view.byteLength
    ) {
      return offset;
    }
  }

  throw new Error("ZIP end of central directory record was not found.");
}

function readCentralDirectoryInfo(
  view: DataView,
  endOffset: number,
): CentralDirectoryInfo {
  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDiskNumber = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const size = view.getUint32(endOffset + 12, true);
  const offset = view.getUint32(endOffset + 16, true);
  const usesZip64 =
    diskNumber === UINT16_MAX ||
    directoryDiskNumber === UINT16_MAX ||
    entriesOnDisk === UINT16_MAX ||
    entryCount === UINT16_MAX ||
    size === UINT32_MAX ||
    offset === UINT32_MAX;

  if (usesZip64) {
    return readZip64CentralDirectoryInfo(view, endOffset, {
      diskNumber,
      directoryDiskNumber,
      entriesOnDisk,
      entryCount,
      size,
      offset,
    });
  }

  if (
    diskNumber !== 0 ||
    directoryDiskNumber !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    throw new Error("Split ZIP archives are not supported.");
  }

  return { offset, size, entryCount, trailerOffset: endOffset };
}

function readZip64CentralDirectoryInfo(
  view: DataView,
  endOffset: number,
  legacy: {
    readonly diskNumber: number;
    readonly directoryDiskNumber: number;
    readonly entriesOnDisk: number;
    readonly entryCount: number;
    readonly size: number;
    readonly offset: number;
  },
): CentralDirectoryInfo {
  const locatorOffset =
    endOffset - ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_LENGTH;
  ensureRange(
    view,
    locatorOffset,
    ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_LENGTH,
  );
  if (
    view.getUint32(locatorOffset, true) !==
    ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
  ) {
    throw new Error("ZIP64 end of central directory locator was not found.");
  }

  const locatorDisk = view.getUint32(locatorOffset + 4, true);
  const zip64Offset = toSafeNumber(
    view.getBigUint64(locatorOffset + 8, true),
    "ZIP64 end record offset",
  );
  const totalDisks = view.getUint32(locatorOffset + 16, true);
  ensureRange(view, zip64Offset, ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH);
  if (
    locatorDisk !== 0 ||
    totalDisks !== 1 ||
    view.getUint32(zip64Offset, true) !==
      ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE
  ) {
    throw new Error("Split or malformed ZIP64 archive is not supported.");
  }

  const zip64RecordSize = toSafeNumber(
    view.getBigUint64(zip64Offset + 4, true),
    "ZIP64 end record size",
  );
  if (
    zip64RecordSize < ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH - 12 ||
    zip64Offset + 12 + zip64RecordSize !== locatorOffset
  ) {
    throw new Error("ZIP64 end of central directory record is malformed.");
  }

  const diskNumber = view.getUint32(zip64Offset + 16, true);
  const directoryDiskNumber = view.getUint32(zip64Offset + 20, true);
  const entriesOnDisk = view.getBigUint64(zip64Offset + 24, true);
  const entryCount = view.getBigUint64(zip64Offset + 32, true);
  const size = view.getBigUint64(zip64Offset + 40, true);
  const offset = view.getBigUint64(zip64Offset + 48, true);
  if (
    diskNumber !== 0 ||
    directoryDiskNumber !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    throw new Error("Split ZIP64 archives are not supported.");
  }

  assertLegacyValue(legacy.diskNumber, UINT16_MAX, BigInt(diskNumber));
  assertLegacyValue(
    legacy.directoryDiskNumber,
    UINT16_MAX,
    BigInt(directoryDiskNumber),
  );
  assertLegacyValue(legacy.entriesOnDisk, UINT16_MAX, entriesOnDisk);
  assertLegacyValue(legacy.entryCount, UINT16_MAX, entryCount);
  assertLegacyValue(legacy.size, UINT32_MAX, size);
  assertLegacyValue(legacy.offset, UINT32_MAX, offset);

  return {
    offset: toSafeNumber(offset, "ZIP64 central directory offset"),
    size: toSafeNumber(size, "ZIP64 central directory size"),
    entryCount: toSafeNumber(entryCount, "ZIP64 entry count"),
    trailerOffset: zip64Offset,
  };
}

function countCentralDirectoryEntries(
  view: DataView,
  directoryOffset: number,
  directorySize: number,
): number {
  ensureRange(view, directoryOffset, directorySize);
  const endOffset = directoryOffset + directorySize;
  let entryCount = 0;
  let offset = directoryOffset;

  while (offset < endOffset) {
    ensureRange(view, offset, 4, endOffset);
    const signature = view.getUint32(offset, true);
    if (signature === CENTRAL_FILE_HEADER_SIGNATURE) {
      ensureRange(view, offset, CENTRAL_FILE_HEADER_LENGTH, endOffset);
      const variableLength =
        view.getUint16(offset + 28, true) +
        view.getUint16(offset + 30, true) +
        view.getUint16(offset + 32, true);
      ensureRange(
        view,
        offset,
        CENTRAL_FILE_HEADER_LENGTH + variableLength,
        endOffset,
      );
      offset += CENTRAL_FILE_HEADER_LENGTH + variableLength;
      entryCount += 1;
    } else if (signature === CENTRAL_DIRECTORY_DIGITAL_SIGNATURE) {
      ensureRange(view, offset, 6, endOffset);
      const recordLength = 6 + view.getUint16(offset + 4, true);
      ensureRange(view, offset, recordLength, endOffset);
      offset += recordLength;
    } else if (signature === ARCHIVE_EXTRA_DATA_SIGNATURE) {
      ensureRange(view, offset, 8, endOffset);
      const recordLength = 8 + view.getUint32(offset + 4, true);
      ensureRange(view, offset, recordLength, endOffset);
      offset += recordLength;
    } else {
      throw new Error("ZIP central directory contains an unknown record.");
    }
  }

  return entryCount;
}

function assertLegacyValue(
  legacyValue: number,
  sentinel: number,
  zip64Value: bigint,
): void {
  if (legacyValue !== sentinel && BigInt(legacyValue) !== zip64Value) {
    throw new Error("ZIP64 end records contain contradictory values.");
  }
}

function ensureRange(
  view: DataView,
  offset: number,
  length: number,
  endOffset = view.byteLength,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > endOffset ||
    endOffset > view.byteLength
  ) {
    throw new Error("ZIP record exceeds its declared boundaries.");
  }
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the supported safe integer range.`);
  }
  return Number(value);
}
