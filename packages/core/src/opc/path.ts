export type PartNameDiagnosticCode =
  | "absolute-part-name"
  | "backslash-in-part-name"
  | "empty-part-name"
  | "invalid-part-name"
  | "path-traversal";

export type PartNameResult =
  | { readonly ok: true; readonly partName: string }
  | {
      readonly ok: false;
      readonly code: PartNameDiagnosticCode;
      readonly message: string;
    };

/** OPC compares package part URIs using ASCII case-insensitive equivalence. */
export function partNameComparisonKey(partName: string): string {
  return partName.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

/** Canonicalizes a ZIP entry name into the package-internal representation. */
export function canonicalizeEntryPartName(rawName: string): PartNameResult {
  if (rawName === "") return failure("empty-part-name", "Part name is empty.");
  if (rawName.includes("\0")) {
    return failure("invalid-part-name", "Part name contains a NUL byte.");
  }
  if (rawName.includes("\\")) {
    return failure(
      "backslash-in-part-name",
      "Part name uses a backslash separator.",
    );
  }
  if (rawName.startsWith("/") || /^[A-Za-z]:/u.test(rawName)) {
    return failure(
      "absolute-part-name",
      "ZIP entry part names must be package-relative.",
    );
  }
  return normalizeSegments(rawName);
}

/** Resolves an internal OPC relationship target without performing I/O. */
export function resolveRelationshipTarget(
  sourcePart: string | null,
  rawTarget: string,
): PartNameResult {
  if (rawTarget === "") {
    return failure("empty-part-name", "Relationship target is empty.");
  }
  if (
    rawTarget.includes("\0") ||
    rawTarget.includes("\\") ||
    rawTarget.includes("?") ||
    rawTarget.includes("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(rawTarget)
  ) {
    return failure(
      "invalid-part-name",
      "Internal relationship target is not a valid package part URI.",
    );
  }

  const rooted = rawTarget.startsWith("/");
  const relativeBase =
    rooted || sourcePart === null
      ? ""
      : sourcePart.slice(0, Math.max(0, sourcePart.lastIndexOf("/") + 1));
  return normalizeSegments(
    `${relativeBase}${rooted ? rawTarget.slice(1) : rawTarget}`,
  );
}

function normalizeSegments(value: string): PartNameResult {
  const result: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (result.length === 0) {
        return failure(
          "path-traversal",
          "Part path traverses above the package root.",
        );
      }
      result.pop();
    } else {
      result.push(segment);
    }
  }
  return result.length === 0
    ? failure("empty-part-name", "Part name resolves to the package root.")
    : { ok: true, partName: result.join("/") };
}

function failure(
  code: PartNameDiagnosticCode,
  message: string,
): Extract<PartNameResult, { readonly ok: false }> {
  return { ok: false, code, message };
}
