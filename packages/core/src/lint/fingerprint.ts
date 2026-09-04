import type { FindingLocation, RuleId } from "./types.js";

export interface FingerprintInput {
  readonly inputKey: string;
  readonly ruleId: RuleId;
  readonly location: FindingLocation;
  readonly discriminator: string;
}

export async function createFindingFingerprint(
  input: FingerprintInput,
): Promise<string> {
  const identity = JSON.stringify({
    schemaVersion: 1,
    ruleId: input.ruleId,
    inputKey: input.inputKey,
    part: input.location.part ?? null,
    slideId: input.location.slideId ?? null,
    slideNumber: input.location.slideNumber ?? null,
    shapeIds: [...(input.location.shapeIds ?? [])].sort(
      (left, right) => left - right,
    ),
    discriminator: input.discriminator,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
