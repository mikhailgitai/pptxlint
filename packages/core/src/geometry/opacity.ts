export type OpacityState = "opaque" | "not-opaque" | "unknown";

export type OpacityBasis =
  | "embedded-image"
  | "fill-unresolved"
  | "image-alpha-effect"
  | "image-effects-unresolved"
  | "image-reference-unresolved"
  | "jpeg"
  | "media-unreadable"
  | "no-fill"
  | "png-alpha-channel"
  | "png-without-alpha"
  | "shape-effects-unresolved"
  | "solid-fill"
  | "theme-color-unresolved"
  | "unsupported-fill"
  | "unsupported-image-format"
  | "unsupported-shape-geometry"
  | "unsupported-shape-kind";

export interface OpacityEvidence {
  readonly state: OpacityState;
  readonly basis: OpacityBasis;
  /** Normalized DrawingML alpha when it can be resolved without rendering. */
  readonly alpha?: number;
  /** Embedded image relationship used by picture shapes. */
  readonly imageRelationshipId?: string;
}

export interface RasterOpacityEvidence {
  readonly state: OpacityState;
  readonly basis:
    | "jpeg"
    | "png-alpha-channel"
    | "png-without-alpha"
    | "unsupported-image-format";
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

/**
 * Classifies only raster formats whose alpha capability can be established
 * from their container structure. It deliberately does not decode pixels.
 */
export function inspectRasterOpacity(bytes: Uint8Array): RasterOpacityEvidence {
  if (isJpeg(bytes)) return { state: "opaque", basis: "jpeg" };
  if (!hasPrefix(bytes, PNG_SIGNATURE)) {
    return { state: "unknown", basis: "unsupported-image-format" };
  }

  const png = inspectPngAlphaChannel(bytes);
  return png === "absent"
    ? { state: "opaque", basis: "png-without-alpha" }
    : png === "present"
      ? { state: "unknown", basis: "png-alpha-channel" }
      : { state: "unknown", basis: "unsupported-image-format" };
}

function isJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 5 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    return false;
  }
  for (let index = 3; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return true;
  }
  return false;
}

function inspectPngAlphaChannel(
  bytes: Uint8Array,
): "absent" | "present" | "unknown" {
  let offset: number = PNG_SIGNATURE.length;
  let colorType: number | undefined;
  let hasTransparencyChunk = false;
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = readUint32BigEndian(bytes, offset);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;
    if (nextOffset > bytes.length) return "unknown";
    const type = ascii(bytes, offset + 4, 4);

    if (colorType === undefined) {
      if (type !== "IHDR" || length !== 13) return "unknown";
      colorType = bytes[dataOffset + 9];
      if (![0, 2, 3, 4, 6].includes(colorType ?? -1)) return "unknown";
    } else if (type === "IHDR") {
      return "unknown";
    }

    if (type === "tRNS") hasTransparencyChunk = true;
    if (type === "IEND") {
      if (length !== 0) return "unknown";
      sawEnd = true;
      break;
    }
    offset = nextOffset;
  }

  if (!sawEnd || colorType === undefined) return "unknown";
  return colorType === 4 || colorType === 6 || hasTransparencyChunk
    ? "present"
    : "absent";
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}
