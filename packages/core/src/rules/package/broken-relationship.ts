import type { PptxLintRule } from "../../lint/rule.js";
import type { FindingDraft } from "../../lint/rule.js";
import { mediaKindForRelationship } from "./media.js";
import { packageRuleDescriptor } from "./shared.js";

export const brokenRelationshipRule: PptxLintRule = {
  descriptor: packageRuleDescriptor("package/broken-relationship", [
    "relationships",
  ]),
  analyze(context) {
    const findings: FindingDraft[] = [];
    for (const relationship of context.relationships.relationships) {
      if (
        relationship.targetMode !== "internal" ||
        relationship.targetExists !== false ||
        mediaKindForRelationship(relationship.type) !== null
      ) {
        continue;
      }
      findings.push({
        message: `Internal relationship ${relationship.id} points to a missing package part.`,
        location: {
          part: relationship.sourcePart ?? relationship.relationshipsPart,
        },
        evidence: relationshipEvidence(relationship),
        fingerprintDiscriminator: relationshipDiscriminator(relationship),
      });
    }
    return Promise.resolve(findings);
  },
};

function relationshipEvidence(relationship: {
  readonly sourcePart: string | null;
  readonly relationshipsPart: string;
  readonly id: string;
  readonly type: string;
  readonly rawTarget: string;
  readonly resolvedTarget: string | null;
}) {
  return {
    rawTarget: relationship.rawTarget,
    relationshipId: relationship.id,
    relationshipPart: relationship.relationshipsPart,
    relationshipType: relationship.type,
    resolvedTarget: relationship.resolvedTarget,
    sourcePart: relationship.sourcePart,
  } as const;
}

function relationshipDiscriminator(relationship: {
  readonly relationshipsPart: string;
  readonly id: string;
  readonly rawTarget: string;
  readonly resolvedTarget: string | null;
}): string {
  return [
    relationship.relationshipsPart,
    relationship.id,
    relationship.resolvedTarget ?? relationship.rawTarget,
  ].join("\0");
}
