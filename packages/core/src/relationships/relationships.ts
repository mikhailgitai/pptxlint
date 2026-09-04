import type { ArchiveIndex } from "../archive/archive-index.js";
import type { ContextDiagnostic } from "../context/types.js";
import {
  partNameComparisonKey,
  resolveRelationshipTarget,
} from "../opc/path.js";
import { childElements, getAttribute } from "../xml/query.js";
import type { XmlPartStore } from "../xml/xml-part-store.js";

export const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export const OFFICE_RELATIONSHIP_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
export const STRICT_OFFICE_RELATIONSHIP_BASE =
  "http://purl.oclc.org/ooxml/officeDocument/relationships/";

export type RelationshipTargetMode = "external" | "internal";

export interface PackageRelationship {
  readonly sourcePart: string | null;
  readonly relationshipsPart: string;
  readonly id: string;
  readonly type: string;
  readonly targetMode: RelationshipTargetMode;
  readonly rawTarget: string;
  readonly resolvedTarget: string | null;
  readonly targetExists: boolean | null;
}

export interface RelationshipGraph {
  readonly relationships: readonly PackageRelationship[];
  outgoing(sourcePart: string | null): readonly PackageRelationship[];
  incoming(targetPart: string): readonly PackageRelationship[];
  getById(
    sourcePart: string | null,
    relationshipId: string,
  ): PackageRelationship | undefined;
}

export interface RelationshipGraphResult {
  readonly graph: RelationshipGraph;
  readonly diagnostics: readonly ContextDiagnostic[];
}

export async function buildRelationshipGraph(
  archive: ArchiveIndex,
  xml: XmlPartStore,
): Promise<RelationshipGraphResult> {
  const relationships: PackageRelationship[] = [];
  const diagnostics: ContextDiagnostic[] = [];
  const relationshipParts = archive
    .list()
    .map((entry) => entry.name)
    .filter(isRelationshipsPart)
    .sort();

  for (const relationshipsPart of relationshipParts) {
    const sourcePart = sourcePartForRelationships(relationshipsPart);
    const parsed = await xml.get(relationshipsPart);
    if (!parsed.ok) {
      diagnostics.push({
        code: "invalid-relationships",
        message: parsed.diagnostic.message,
        partName: relationshipsPart,
        relationshipId: null,
      });
      if (
        parsed.diagnostic.code === "malformed-xml" ||
        parsed.diagnostic.code === "dtd-prohibited" ||
        parsed.diagnostic.code === "invalid-namespace" ||
        parsed.diagnostic.code === "unsupported-encoding"
      ) {
        diagnostics.push({
          code: "malformed-xml",
          message: parsed.diagnostic.message,
          partName: relationshipsPart,
          relationshipId: null,
        });
      }
      continue;
    }

    const root = parsed.document.root;
    if (
      root.name.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE ||
      root.name.localName !== "Relationships"
    ) {
      diagnostics.push({
        code: "invalid-relationships",
        message: "Relationships part has an unexpected root element.",
        partName: relationshipsPart,
        relationshipId: null,
      });
      continue;
    }

    const ids = new Set<string>();
    for (const element of childElements(root)) {
      if (
        element.name.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE ||
        element.name.localName !== "Relationship"
      ) {
        continue;
      }
      const id = getAttribute(element, null, "Id")?.value;
      const type = getAttribute(element, null, "Type")?.value;
      const target = getAttribute(element, null, "Target")?.value;
      if (id === undefined || type === undefined || target === undefined) {
        diagnostics.push({
          code: "invalid-relationships",
          message: "Relationship is missing Id, Type, or Target.",
          partName: relationshipsPart,
          relationshipId: id ?? null,
        });
        continue;
      }
      if (ids.has(id)) {
        diagnostics.push({
          code: "duplicate-relationship-id",
          message: `Relationship Id ${JSON.stringify(id)} is duplicated.`,
          partName: relationshipsPart,
          relationshipId: id,
        });
        continue;
      }
      ids.add(id);

      const external =
        getAttribute(element, null, "TargetMode")?.value === "External";
      if (external) {
        relationships.push({
          sourcePart,
          relationshipsPart,
          id,
          type,
          targetMode: "external",
          rawTarget: target,
          resolvedTarget: null,
          targetExists: null,
        });
        continue;
      }

      const resolved = resolveRelationshipTarget(sourcePart, target);
      if (!resolved.ok) {
        diagnostics.push({
          code: "invalid-relationship-target",
          message: resolved.message,
          partName: relationshipsPart,
          relationshipId: id,
        });
        relationships.push({
          sourcePart,
          relationshipsPart,
          id,
          type,
          targetMode: "internal",
          rawTarget: target,
          resolvedTarget: null,
          targetExists: false,
        });
      } else {
        relationships.push({
          sourcePart,
          relationshipsPart,
          id,
          type,
          targetMode: "internal",
          rawTarget: target,
          resolvedTarget: resolved.partName,
          targetExists: archive.has(resolved.partName),
        });
      }
    }
  }

  return { graph: createGraph(relationships), diagnostics };
}

export function relationshipType(localName: string): string {
  return `${OFFICE_RELATIONSHIP_BASE}${localName}`;
}

export function relationshipsPartForSource(sourcePart: string | null): string {
  if (sourcePart === null) return "_rels/.rels";
  const separator = sourcePart.lastIndexOf("/");
  const directory = separator === -1 ? "" : sourcePart.slice(0, separator);
  const fileName = sourcePart.slice(separator + 1);
  return `${directory === "" ? "" : `${directory}/`}_rels/${fileName}.rels`;
}

export function isRelationshipType(type: string, localName: string): boolean {
  return (
    type === `${OFFICE_RELATIONSHIP_BASE}${localName}` ||
    type === `${STRICT_OFFICE_RELATIONSHIP_BASE}${localName}`
  );
}

function createGraph(
  relationships: readonly PackageRelationship[],
): RelationshipGraph {
  return {
    relationships,
    outgoing: (sourcePart) =>
      relationships.filter((relationship) =>
        samePart(relationship.sourcePart, sourcePart),
      ),
    incoming: (targetPart) =>
      relationships.filter(
        (relationship) =>
          relationship.resolvedTarget !== null &&
          partNameComparisonKey(relationship.resolvedTarget) ===
            partNameComparisonKey(targetPart),
      ),
    getById: (sourcePart, relationshipId) =>
      relationships.find(
        (relationship) =>
          samePart(relationship.sourcePart, sourcePart) &&
          relationship.id === relationshipId,
      ),
  };
}

function isRelationshipsPart(partName: string): boolean {
  return /(?:^|\/)_rels\/[^/]*\.rels$/u.test(partNameComparisonKey(partName));
}

function sourcePartForRelationships(partName: string): string | null {
  const key = partNameComparisonKey(partName);
  if (key === "_rels/.rels") return null;
  const marker = "/_rels/";
  const markerIndex = key.lastIndexOf(marker);
  const prefix = partName.slice(0, markerIndex);
  const suffix = partName.slice(markerIndex + marker.length, -".rels".length);
  return `${prefix}/${suffix}`;
}

function samePart(left: string | null, right: string | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      partNameComparisonKey(left) === partNameComparisonKey(right))
  );
}
