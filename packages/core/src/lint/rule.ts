import type { PptxContext } from "../context/types.js";
import type {
  FindingEvidence,
  FindingLocation,
  RuleId,
  RuleSeverity,
  Severity,
} from "./types.js";

export type ContextCapability =
  "archive" | "presentation" | "relationships" | "text" | "xml";

export interface FindingDraft {
  readonly severity?: Severity;
  readonly message: string;
  readonly location: FindingLocation;
  readonly evidence: FindingEvidence;
  readonly fingerprintDiscriminator: string;
}

export interface RuleDescriptor<Options> {
  readonly id: RuleId;
  readonly defaultSeverity: RuleSeverity;
  readonly prerequisites: readonly ContextCapability[];
  readonly defaultOptions: Options;
  validateOptions(value: unknown): Options;
}

export interface PptxLintRule<Options = unknown> {
  readonly descriptor: RuleDescriptor<Options>;
  analyze(
    context: PptxContext,
    options: Options,
  ): Promise<readonly FindingDraft[]>;
}
