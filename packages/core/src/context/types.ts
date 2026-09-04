import type { ArchiveIndex } from "../archive/archive-index.js";
import type { ContentTypeIndex } from "../content-types/content-types.js";
import type { PresentationIndex } from "../presentation/presentation.js";
import type { RelationshipGraph } from "../relationships/relationships.js";
import type { PresentationTextIndex } from "../text/types.js";
import type { XmlPartStore } from "../xml/xml-part-store.js";

export type ContextDiagnosticCode =
  | "ambiguous-part-name"
  | "archive-limit-exceeded"
  | "duplicate-content-type"
  | "duplicate-relationship-id"
  | "entry-read-failed"
  | "invalid-content-types"
  | "invalid-part-name"
  | "invalid-presentation"
  | "invalid-relationship-target"
  | "invalid-relationships"
  | "invalid-zip"
  | "malformed-xml"
  | "missing-content-types"
  | "missing-office-document"
  | "missing-presentation-part"
  | "missing-presentation-relationship"
  | "missing-presentation-target"
  | "unsupported-geometry";

export interface ContextDiagnostic {
  readonly code: ContextDiagnosticCode;
  readonly message: string;
  readonly partName: string | null;
  readonly relationshipId: string | null;
}

export interface PptxIdentity {
  readonly inputKey: string;
  readonly sourceSha256: string;
}

export interface PptxContext {
  readonly identity: PptxIdentity;
  readonly archive: ArchiveIndex;
  readonly xml: XmlPartStore;
  readonly contentTypes: ContentTypeIndex;
  readonly relationships: RelationshipGraph;
  readonly presentation: PresentationIndex | null;
  readonly text: PresentationTextIndex;
  readonly diagnostics: readonly ContextDiagnostic[];
  readonly analysisComplete: boolean;
  close(): Promise<void>;
}

export type PptxContextBuildResult =
  | { readonly ok: true; readonly context: PptxContext }
  | {
      readonly ok: false;
      readonly diagnostic: ContextDiagnostic;
    };
