import { describe, expect, it } from "vitest";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import {
  buildMinimalPptx,
  buildRawZip,
} from "../../../fixtures/builders/index.js";
import {
  createArchiveIndex,
  DEFAULT_ARCHIVE_SECURITY_LIMITS,
  HARD_ARCHIVE_SECURITY_LIMITS,
  openZipArchive,
  resolveArchiveSecurityLimits,
  type ZipArchive,
} from "../src/archive/index.js";

const decoder = new TextDecoder();

describe("safe ZIP adapter", () => {
  it("uses the documented hard security ceilings", () => {
    expect(DEFAULT_ARCHIVE_SECURITY_LIMITS).toEqual({
      maxEntries: 10_000,
      maxPartUncompressedBytes: 256 * 1024 * 1024,
      maxXmlUncompressedBytes: 20 * 1024 * 1024,
      maxTotalUncompressedBytes: 1024 * 1024 * 1024,
      maxCompressionRatio: 200,
    });
    expect(DEFAULT_ARCHIVE_SECURITY_LIMITS).toEqual(
      HARD_ARCHIVE_SECURITY_LIMITS,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, undefined])(
    "rejects unsafe runtime limit override %s",
    (value) => {
      expect(() =>
        resolveArchiveSecurityLimits({
          maxEntries: value,
        } as unknown as Partial<typeof DEFAULT_ARCHIVE_SECURITY_LIMITS>),
      ).toThrow(TypeError);
    },
  );

  it("does not allow overrides above hard ceilings", () => {
    expect(
      resolveArchiveSecurityLimits({ maxCompressionRatio: 12.5 })
        .maxCompressionRatio,
    ).toBe(12.5);
    expect(() =>
      resolveArchiveSecurityLimits({
        maxCompressionRatio:
          HARD_ARCHIVE_SECURITY_LIMITS.maxCompressionRatio + 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      resolveArchiveSecurityLimits(
        null as unknown as Partial<typeof DEFAULT_ARCHIVE_SECURITY_LIMITS>,
      ),
    ).toThrow(TypeError);
  });

  it("applies the XML limit independently from the general part limit", async () => {
    const opened = await openZipArchive(
      buildRawZip([
        { name: "data.bin", data: new Uint8Array(300) },
        { name: "other.bin", data: new Uint8Array(300) },
        { name: "slide.xml", data: new Uint8Array(300) },
      ]),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const { index } = createArchiveIndex(
      opened.archive,
      resolveArchiveSecurityLimits({
        maxPartUncompressedBytes: 400,
        maxXmlUncompressedBytes: 200,
      }),
    );

    index.registerXmlParts(["DATA.BIN"]);
    await expect(index.read("other.bin")).resolves.toMatchObject({ ok: true });
    await expect(index.read("data.bin")).resolves.toMatchObject({
      ok: false,
      code: "part-limit-exceeded",
    });
    await expect(index.read("slide.xml")).resolves.toMatchObject({
      ok: false,
      code: "part-limit-exceeded",
    });
    await index.close();
  });

  it("treats ASCII-case variants as ambiguous OPC part names", async () => {
    const opened = await openZipArchive(
      buildRawZip([
        { name: "ppt/a.xml", data: "<first/>" },
        { name: "PPT/A.XML", data: "<second/>" },
      ]),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const { index, diagnostics } = createArchiveIndex(opened.archive);

    expect(index.duplicates()).toEqual(["ppt/a.xml"]);
    expect(index.has("PpT/A.xMl")).toBe(false);
    await expect(index.read("PPT/a.xml")).resolves.toMatchObject({
      ok: false,
      code: "ambiguous-part-name",
    });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous-part-name" }),
      ]),
    );
    await index.close();
  });

  it("indexes metadata and reads entry data lazily", async () => {
    const opened = await openZipArchive(buildMinimalPptx());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.archive.entries.map((entry) => entry.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/presProps.xml",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/slides/slide1.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/theme/theme1.xml",
    ]);
    expect(opened.archive.duplicateNames).toEqual([]);

    const slide = opened.archive.entries.find(
      (entry) => entry.name === "ppt/slides/slide1.xml",
    );
    expect(slide).toMatchObject({
      name: "ppt/slides/slide1.xml",
      compressionMethod: 0,
      directory: false,
      encrypted: false,
    });
    expect(slide?.compressedSize).toBe(slide?.uncompressedSize);
    expect(slide?.crc32).toBeTypeOf("number");

    const firstRead = await slide?.read();
    const secondRead = await slide?.read();
    expect(firstRead).toBe(secondRead);
    expect(firstRead?.ok).toBe(true);
    if (firstRead?.ok) {
      expect(decoder.decode(firstRead.bytes)).toContain("<p:sld");
    }

    await opened.archive.close();
  });

  it("preserves duplicate names and both entry payloads", async () => {
    const bytes = buildRawZip([
      { name: "ppt/slides/slide1.xml", data: "first" },
      { name: "ppt/slides/slide1.xml", data: "second" },
    ]);
    const opened = await openZipArchive(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.archive.duplicateNames).toEqual(["ppt/slides/slide1.xml"]);
    expect(opened.archive.entries).toHaveLength(2);

    const reads = await Promise.all(
      opened.archive.entries.map(async (entry) => entry.read()),
    );
    expect(
      reads.map((result) =>
        result.ok ? decoder.decode(result.bytes) : result.diagnostic.code,
      ),
    ).toEqual(["first", "second"]);

    await opened.archive.close();
  });

  it("returns a diagnostic for a truncated central directory", async () => {
    const bytes = buildRawZip([{ name: "hello.txt", data: "hello" }], {
      truncateEndBytes: 8,
    });
    const opened = await openZipArchive(bytes);

    expect(opened).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-zip" },
    });
  });

  it("rejects central-directory entries hidden by an understated EOCD count", async () => {
    const bytes = buildRawZip(
      [
        { name: "duplicate.xml", data: "first" },
        { name: "duplicate.xml", data: "hidden" },
      ],
      { eocdEntryCountOverride: 1 },
    );

    await expect(openZipArchive(bytes)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-zip" },
    });
  });

  it("validates and opens ZIP64 central-directory records", async () => {
    const opened = await openZipArchive(
      buildRawZip([{ name: "zip64.xml", data: "<root/>" }], {
        forceZip64: true,
      }),
    );

    expect(opened).toMatchObject({ ok: true });
    if (opened.ok) {
      expect(opened.archive.entries.map((entry) => entry.name)).toEqual([
        "zip64.xml",
      ]);
      await opened.archive.close();
    }
  });

  it("returns lazy read failures for bad CRC and contradictory headers", async () => {
    const fixtures = [
      buildRawZip([{ name: "bad-crc.xml", data: "payload", crc32Override: 1 }]),
      buildRawZip([
        {
          name: "central-name.xml",
          localHeaderName: "local-name.xml",
          data: "payload",
        },
      ]),
    ];

    for (const fixture of fixtures) {
      const opened = await openZipArchive(fixture);
      expect(opened.ok).toBe(true);
      if (!opened.ok) continue;

      const read = await opened.archive.entries[0]?.read();
      expect(read).toMatchObject({
        ok: false,
        diagnostic: { code: "entry-read-failed" },
      });
      await opened.archive.close();
    }
  });

  it("rejects actual-vs-declared metadata mismatch before allocation", async () => {
    const opened = await openZipArchive(
      buildRawZip([
        {
          name: "underdeclared.bin",
          data: new Uint8Array(128),
          declaredUncompressedSizeOverride: 16,
        },
      ]),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const read = await opened.archive.entries[0]?.read();
    expect(read?.ok).toBe(false);
    if (read === undefined || read.ok) return;
    expect(read.diagnostic.code).toBe("entry-read-failed");
    expect(read.diagnostic.message).toContain("Ambiguous archive");
    await opened.archive.close();
  });

  it("stops deflate output that exceeds forged declared bytes", async () => {
    const opened = await openZipArchive(await underdeclaredDeflateZip());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const read = await opened.archive.entries[0]?.read();
    expect(read?.ok).toBe(false);
    if (read === undefined || read.ok) return;
    expect(read.diagnostic.code).toBe("actual-size-limit-exceeded");
    await opened.archive.close();
  });

  it("reads deflate output through the declared-size buffer", async () => {
    const data = new Uint8Array(256);
    data.fill(0x5a);
    const opened = await openZipArchive(await deflateZip(data));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const read = await opened.archive.entries[0]?.read();
    expect(read?.ok).toBe(true);
    if (!read?.ok) return;
    expect(read.bytes).toEqual(data);
    expect(read.bytes.byteLength).toBe(
      opened.archive.entries[0]?.uncompressedSize,
    );
    await opened.archive.close();
  });

  it("propagates the runtime byte cap into lazy entry extraction", async () => {
    let observedLimit: number | undefined;
    const archive: ZipArchive = {
      entries: [
        {
          index: 0,
          name: "payload.bin",
          rawName: new TextEncoder().encode("payload.bin"),
          compressedSize: 16,
          uncompressedSize: 32,
          crc32: 0,
          compressionMethod: 8,
          directory: false,
          encrypted: false,
          read(maximumBytes) {
            observedLimit = maximumBytes;
            return Promise.resolve({
              ok: false,
              diagnostic: {
                code: "actual-size-limit-exceeded",
                message: "bounded writer stopped extraction",
              },
            });
          },
        },
      ],
      duplicateNames: [],
      close: () => Promise.resolve(),
    };
    const { index } = createArchiveIndex(
      archive,
      resolveArchiveSecurityLimits({ maxPartUncompressedBytes: 64 }),
    );

    await expect(index.read("payload.bin")).resolves.toMatchObject({
      ok: false,
      code: "part-limit-exceeded",
    });
    expect(observedLimit).toBe(64);
    await index.close();
  });

  it("does not allow new reads after close", async () => {
    const opened = await openZipArchive(
      buildRawZip([{ name: "part.xml", data: "<part/>" }]),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    await opened.archive.close();
    await expect(opened.archive.entries[0]?.read()).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "archive-closed" },
    });
  });
});

async function underdeclaredDeflateZip(): Promise<Uint8Array> {
  const bytes = await deflateZip(new Uint8Array(128));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(22, 16, true);
  const centralDirectoryOffset = findSignature(bytes, 0x02014b50);
  view.setUint32(centralDirectoryOffset + 24, 16, true);
  return bytes;
}

async function deflateZip(data: Uint8Array): Promise<Uint8Array> {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { useWebWorkers: false });
  await writer.add("underdeclared.bin", new Uint8ArrayReader(data), {
    level: 6,
    useWebWorkers: false,
  });
  return writer.close();
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  throw new TypeError(`ZIP signature ${signature.toString(16)} was not found.`);
}
