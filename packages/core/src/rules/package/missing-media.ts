import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import { partNameComparisonKey } from "../../opc/path.js";
import type { PackageRelationship } from "../../relationships/relationships.js";
import { mediaKindForRelationship } from "./media.js";
import { packageRuleDescriptor } from "./shared.js";

export const missingMediaRule: PptxLintRule = {
  descriptor: packageRuleDescriptor("package/missing-media", ["relationships"]),
  analyze(context) {
    const findings: FindingDraft[] = [];
    for (const relationship of context.relationships.relationships) {
      const mediaKind = mediaKindForRelationship(relationship.type);
      if (
        mediaKind === null ||
        relationship.targetMode !== "internal" ||
        relationship.targetExists !== false
      ) {
        continue;
      }
      const slide = context.presentation?.slides.find(
        (candidate) =>
          candidate.partName !== null &&
          relationship.sourcePart !== null &&
          partNameComparisonKey(candidate.partName) ===
            partNameComparisonKey(relationship.sourcePart),
      );
      findings.push({
        message: `Referenced ${mediaKind} target ${JSON.stringify(relationship.rawTarget)} is missing.`,
        location: {
          part: relationship.sourcePart ?? relationship.relationshipsPart,
          ...(slide === undefined
            ? {}
            : { slideId: slide.persistentId, slideNumber: slide.number }),
        },
        evidence: {
          mediaKind,
          rawTarget: relationship.rawTarget,
          referencingSlide: slide?.number ?? null,
          relationshipId: relationship.id,
          relationshipPart: relationship.relationshipsPart,
          relationshipType: relationship.type,
          resolvedTarget: relationship.resolvedTarget,
          sourcePart: relationship.sourcePart,
        },
        fingerprintDiscriminator: relationshipDiscriminator(relationship),
      });
    }
    return Promise.resolve(findings);
  },
};

function relationshipDiscriminator(relationship: PackageRelationship): string {
  return [
    relationship.relationshipsPart,
    relationship.id,
    relationship.resolvedTarget ?? relationship.rawTarget,
  ].join("\0");
}
