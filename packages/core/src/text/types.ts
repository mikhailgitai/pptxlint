export type TextScriptSlot = "latin" | "eastAsian" | "complexScript";

export type PlaceholderKind = "title" | "body" | "other";

export type ResolvedValue<T> =
  | {
      readonly status: "resolved";
      readonly value: T;
      readonly sourcePart: string;
      readonly sourceKind: string;
      readonly rawValue?: string;
      readonly referencePart?: string;
      readonly referenceKind?: string;
    }
  | {
      readonly status: "unresolved";
      readonly reason: string;
      readonly sourcePart?: string;
      readonly sourceKind?: string;
      readonly rawValue?: string;
    };

export type AutofitState =
  | { readonly kind: "none" }
  | { readonly kind: "shape-to-fit-text" }
  | {
      readonly kind: "runtime";
      readonly persistedScaleRatio?: number;
      readonly rawFontScale?: string;
      readonly sourcePart: string;
      readonly sourceKind: string;
      readonly unusableScaleReason?: string;
    }
  | { readonly kind: "unknown"; readonly reason: string };

export interface EffectiveRunStyle {
  readonly baseFontSizePt: ResolvedValue<number>;
  readonly fontSizePt: ResolvedValue<number>;
  readonly typeface: Readonly<Record<TextScriptSlot, ResolvedValue<string>>>;
  readonly placeholderKind: PlaceholderKind;
  readonly autofit: AutofitState;
}

export interface ResolvedTextRun {
  readonly paragraphIndex: number;
  readonly runIndex: number;
  readonly text: string;
  readonly usedScriptSlots: readonly TextScriptSlot[];
  readonly style: EffectiveRunStyle;
}

export interface ResolvedTextBody {
  readonly partName: string;
  readonly slideNumber: number;
  readonly slideId: string;
  readonly shapeId: number;
  readonly shapeName: string | null;
  readonly textBodyIndex: number;
  readonly placeholderKind: PlaceholderKind;
  readonly autofit: AutofitState;
  readonly runs: readonly ResolvedTextRun[];
}

export interface PresentationTextIndex {
  readonly bodies: readonly ResolvedTextBody[];
}
