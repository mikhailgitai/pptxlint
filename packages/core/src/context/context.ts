import {
  createArchiveIndex,
  resolveArchiveSecurityLimits,
  type ArchiveSecurityLimits,
} from "../archive/archive-index.js";
import { openZipArchive } from "../archive/zip-reader.js";
import { buildContentTypeIndex } from "../content-types/content-types.js";
import { buildPresentationIndex } from "../presentation/presentation.js";
import { buildRelationshipGraph } from "../relationships/relationships.js";
import { buildPresentationTextIndex } from "../text/text-index.js";
import { createXmlPartStore } from "../xml/xml-part-store.js";
import type { ContextDiagnostic, PptxContextBuildResult } from "./types.js";

export interface PptxContextOptions {
  readonly inputKey: string;
  readonly archiveLimits?: Partial<ArchiveSecurityLimits>;
}

export async function buildPptxContext(
  bytes: Uint8Array,
  options: PptxContextOptions,
): Promise<PptxContextBuildResult> {
  const inputKey = normalizeInputKey(options.inputKey);
  const limits = resolveArchiveSecurityLimits(options.archiveLimits);
  const opened = await openZipArchive(bytes);
  if (!opened.ok) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-zip",
        message: opened.diagnostic.message,
        partName: null,
        relationshipId: null,
      },
    };
  }

  const archiveResult = createArchiveIndex(opened.archive, limits);
  const xml = createXmlPartStore(archiveResult.index);
  const contentTypes = await buildContentTypeIndex(xml);
  archiveResult.index.registerXmlParts(
    archiveResult.index
      .list()
      .map((entry) => entry.name)
      .filter((partName) => contentTypes.index.isXml(partName)),
  );
  const relationships = await buildRelationshipGraph(archiveResult.index, xml);
  const presentation = await buildPresentationIndex(
    archiveResult.index,
    xml,
    relationships.graph,
  );
  const text = await buildPresentationTextIndex(
    presentation.index,
    xml,
    relationships.graph,
  );
  const diagnostics = deduplicateDiagnostics([
    ...archiveResult.diagnostics,
    ...contentTypes.diagnostics,
    ...relationships.diagnostics,
    ...presentation.diagnostics,
  ]);

  return {
    ok: true,
    context: {
      identity: {
        inputKey,
        sourceSha256: await sha256(bytes),
      },
      archive: archiveResult.index,
      xml,
      contentTypes: contentTypes.index,
      relationships: relationships.graph,
      presentation: presentation.index,
      text,
      diagnostics,
      analysisComplete: diagnostics.length === 0,
      close: () => archiveResult.index.close(),
    },
  };
}

export function encodeInputKeyPath(
  inputPath: string,
  pathSeparator: string,
): string {
  if (pathSeparator !== "/" && pathSeparator !== "\\") {
    throw new TypeError('pathSeparator must be either "/" or "\\\\".');
  }
  const logicalPath =
    pathSeparator === "/"
      ? inputPath
      : inputPath.replaceAll(pathSeparator, "/");
  return logicalPath.split("/").map(encodeInputKeySegment).join("/");
}

export function normalizeInputKey(inputKey: string): string {
  if (
    inputKey === "" ||
    inputKey.includes("\0") ||
    inputKey.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(inputKey)
  ) {
    throw new TypeError("inputKey must be a non-empty relative path.");
  }
  const segments: string[] = [];
  for (const segment of inputKey.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new TypeError("inputKey must not traverse above its root.");
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (segments.length === 0) {
    throw new TypeError("inputKey must identify a file.");
  }
  return segments.join("/");
}

function encodeInputKeySegment(segment: string): string {
  return segment
    .replaceAll("%", "%25")
    .replaceAll("\\", "%5C")
    .replaceAll(":", "%3A");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput =
    bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function deduplicateDiagnostics(
  diagnostics: readonly ContextDiagnostic[],
): readonly ContextDiagnostic[] {
  const unique = new Map<string, ContextDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\0${diagnostic.partName ?? ""}\0${diagnostic.relationshipId ?? ""}\0${diagnostic.message}`;
    unique.set(key, diagnostic);
  }
  return [...unique.values()];
}
