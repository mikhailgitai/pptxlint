import type {
  LocalShapeKind,
  PresentationIndex,
  PresentationSlide,
} from "../presentation/presentation.js";
import {
  DRAWINGML_NAMESPACE,
  PRESENTATIONML_NAMESPACE,
  STRICT_DRAWINGML_NAMESPACE,
  STRICT_PRESENTATIONML_NAMESPACE,
} from "../presentation/presentation.js";
import {
  isRelationshipType,
  type RelationshipGraph,
} from "../relationships/relationships.js";
import { childElements, findDescendants, getAttribute } from "../xml/query.js";
import type { XmlElement, XmlNode } from "../xml/types.js";
import type { XmlPartStore } from "../xml/xml-part-store.js";
import type {
  AutofitState,
  EffectiveRunStyle,
  PlaceholderKind,
  PresentationTextIndex,
  ResolvedTextBody,
  ResolvedTextRun,
  ResolvedValue,
  TextScriptSlot,
} from "./types.js";

interface PlaceholderIdentity {
  readonly index: string;
  readonly type: string;
}

interface ShapeDefinition {
  readonly element: XmlElement;
  readonly id: number | null;
  readonly name: string | null;
  readonly kind: Exclude<LocalShapeKind, "group">;
  readonly placeholder: PlaceholderIdentity | null;
}

interface StyleSource {
  readonly properties?: XmlElement;
  readonly fontReference?: "major" | "minor";
  readonly sourcePart: string;
  readonly sourceKind: string;
}

interface ThemeContext {
  readonly root: XmlElement | undefined;
  readonly partName: string | null;
  readonly overrideParts: readonly string[];
}

interface TextInheritance {
  readonly localBody: XmlElement;
  readonly layoutBody?: XmlElement;
  readonly masterBody?: XmlElement;
  readonly localShape: ShapeDefinition;
  readonly layoutShape?: ShapeDefinition;
  readonly masterShape?: ShapeDefinition;
  readonly masterRoot?: XmlElement;
  readonly presentationRoot?: XmlElement;
  readonly slidePart: string;
  readonly layoutPart: string | null;
  readonly masterPart: string | null;
  readonly presentationPart: string;
  readonly theme: ThemeContext;
  readonly placeholderKind: PlaceholderKind;
  readonly autofit: AutofitState;
}

const MASTER_PLACEHOLDER_COMPATIBILITY: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  body: ["body"],
  ctrTitle: ["title", "ctrTitle"],
  dt: ["dt"],
  ftr: ["ftr"],
  hdr: ["hdr"],
  obj: ["body", "obj"],
  sldImg: ["sldImg"],
  sldNum: ["sldNum"],
  subTitle: ["body", "subTitle"],
  title: ["title", "ctrTitle"],
  vertBody: ["body", "vertBody"],
  vertTitle: ["title", "vertTitle"],
});

export async function buildPresentationTextIndex(
  presentation: PresentationIndex | null,
  xml: XmlPartStore,
  relationships: RelationshipGraph,
): Promise<PresentationTextIndex> {
  if (presentation === null) return { bodies: [] };

  const presentationRoot = await parsedRoot(presentation.partName, xml);
  const bodies: ResolvedTextBody[] = [];
  for (const slide of presentation.slides) {
    bodies.push(
      ...(await resolveSlideText(
        slide,
        presentation,
        presentationRoot,
        xml,
        relationships,
      )),
    );
  }
  return { bodies };
}

async function resolveSlideText(
  slide: PresentationSlide,
  presentation: PresentationIndex,
  presentationRoot: XmlElement | undefined,
  xml: XmlPartStore,
  relationships: RelationshipGraph,
): Promise<readonly ResolvedTextBody[]> {
  if (!slide.available || slide.partName === null) return [];
  const [slideRoot, layoutRoot, masterRoot, themeRoot] = await Promise.all([
    parsedRoot(slide.partName, xml),
    parsedRoot(slide.layoutPart, xml),
    parsedRoot(slide.masterPart, xml),
    parsedRoot(slide.themePart, xml),
  ]);
  if (slideRoot === undefined) return [];
  const overrideParts = themeOverrideParts(slide, relationships);

  const localShapes = collectShapes(slideRoot);
  const layoutShapes =
    layoutRoot === undefined ? [] : collectShapes(layoutRoot, true);
  const masterShapes =
    masterRoot === undefined ? [] : collectShapes(masterRoot, true);
  const bodies: ResolvedTextBody[] = [];

  for (const shape of localShapes) {
    const localBodies = textBodies(shape);
    if (localBodies.length === 0 || shape.id === null) continue;
    const layoutShape = matchLayoutPlaceholder(shape, layoutShapes);
    const masterShape = matchMasterPlaceholder(
      layoutShape ?? shape,
      masterShapes,
    );
    const effectivePlaceholder =
      shape.placeholder ?? layoutShape?.placeholder ?? masterShape?.placeholder;
    const placeholderKind = classifyPlaceholder(effectivePlaceholder?.type);

    for (const [textBodyIndex, localBody] of localBodies.entries()) {
      const layoutBody = correspondingBody(layoutShape, textBodyIndex);
      const masterBody = correspondingBody(masterShape, textBodyIndex);
      const autofit = resolveAutofit([
        bodySource(localBody, slide.partName, "slide-body-properties"),
        ...(layoutBody === undefined || slide.layoutPart === null
          ? []
          : [
              bodySource(
                layoutBody,
                slide.layoutPart,
                "layout-body-properties",
              ),
            ]),
        ...(masterBody === undefined || slide.masterPart === null
          ? []
          : [
              bodySource(
                masterBody,
                slide.masterPart,
                "master-body-properties",
              ),
            ]),
      ]);
      const inheritance: TextInheritance = {
        localBody,
        ...(layoutBody === undefined ? {} : { layoutBody }),
        ...(masterBody === undefined ? {} : { masterBody }),
        localShape: shape,
        ...(layoutShape === undefined ? {} : { layoutShape }),
        ...(masterShape === undefined ? {} : { masterShape }),
        ...(masterRoot === undefined ? {} : { masterRoot }),
        ...(presentationRoot === undefined ? {} : { presentationRoot }),
        slidePart: slide.partName,
        layoutPart: slide.layoutPart,
        masterPart: slide.masterPart,
        presentationPart: presentation.partName,
        theme: { root: themeRoot, partName: slide.themePart, overrideParts },
        placeholderKind,
        autofit,
      };
      const runs = resolveRuns(inheritance);
      if (runs.length === 0) continue;
      bodies.push({
        partName: slide.partName,
        slideNumber: slide.number,
        slideId: slide.persistentId,
        shapeId: shape.id,
        shapeName: shape.name,
        textBodyIndex,
        placeholderKind,
        autofit,
        runs,
      });
    }
  }
  return bodies;
}

function themeOverrideParts(
  slide: PresentationSlide,
  relationships: RelationshipGraph,
): readonly string[] {
  const sourceParts = [slide.partName, slide.layoutPart].filter(
    (partName): partName is string => partName !== null,
  );
  const overrideParts = sourceParts.flatMap((sourcePart) =>
    relationships
      .outgoing(sourcePart)
      .filter(
        (relationship) =>
          relationship.targetMode === "internal" &&
          isRelationshipType(relationship.type, "themeOverride"),
      )
      .map(
        (relationship) =>
          relationship.resolvedTarget ?? relationship.relationshipsPart,
      ),
  );
  return [...new Set(overrideParts)].sort();
}

function resolveRuns(inheritance: TextInheritance): readonly ResolvedTextRun[] {
  const paragraphs = directDrawingChildren(inheritance.localBody, "p");
  const runs: ResolvedTextRun[] = [];
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const level = paragraphLevel(paragraph);
    let runIndex = 0;
    for (const child of childElements(paragraph)) {
      if (!isDrawingElement(child, "r") && !isDrawingElement(child, "fld")) {
        continue;
      }
      const currentRunIndex = runIndex;
      runIndex += 1;
      const textElement = directDrawingChild(child, "t");
      const text = textElement === undefined ? "" : textContent(textElement);
      if (text.trim() === "") continue;
      const style = resolveRunStyle(child, paragraph, level, text, inheritance);
      runs.push({
        paragraphIndex,
        runIndex: currentRunIndex,
        text,
        usedScriptSlots: usedScriptSlots(text),
        style,
      });
    }
  }
  return runs;
}

function resolveRunStyle(
  run: XmlElement,
  paragraph: XmlElement,
  level: number | null,
  text: string,
  inheritance: TextInheritance,
): EffectiveRunStyle {
  const sources = styleSources(run, paragraph, level, inheritance);
  const baseFontSizePt = resolveFontSize(sources, level);
  const fontSizePt = effectiveFontSize(baseFontSizePt, inheritance.autofit);
  return {
    baseFontSizePt,
    fontSizePt,
    typeface: {
      latin: resolveTypeface("latin", sources, inheritance.theme, text),
      eastAsian: resolveTypeface("eastAsian", sources, inheritance.theme, text),
      complexScript: resolveTypeface(
        "complexScript",
        sources,
        inheritance.theme,
        text,
      ),
    },
    placeholderKind: inheritance.placeholderKind,
    autofit: inheritance.autofit,
  };
}

function styleSources(
  run: XmlElement,
  paragraph: XmlElement,
  level: number | null,
  inheritance: TextInheritance,
): readonly StyleSource[] {
  const sources: StyleSource[] = [];
  addProperties(
    sources,
    directDrawingChild(run, "rPr"),
    inheritance.slidePart,
    "run-properties",
  );
  addProperties(
    sources,
    paragraphDefaultProperties(paragraph),
    inheritance.slidePart,
    "paragraph-default",
  );
  addBodyStyles(
    sources,
    inheritance.localBody,
    level,
    inheritance.slidePart,
    "shape-list-style",
    false,
  );
  addShapeFontReference(
    sources,
    inheritance.localShape,
    inheritance.slidePart,
    "shape-font-reference",
  );

  if (inheritance.layoutBody !== undefined && inheritance.layoutPart !== null) {
    addBodyStyles(
      sources,
      inheritance.layoutBody,
      level,
      inheritance.layoutPart,
      "layout-placeholder-style",
      true,
    );
  }
  if (
    inheritance.layoutShape !== undefined &&
    inheritance.layoutPart !== null
  ) {
    addShapeFontReference(
      sources,
      inheritance.layoutShape,
      inheritance.layoutPart,
      "layout-font-reference",
    );
  }
  if (inheritance.masterBody !== undefined && inheritance.masterPart !== null) {
    addBodyStyles(
      sources,
      inheritance.masterBody,
      level,
      inheritance.masterPart,
      "master-placeholder-style",
      true,
    );
  }
  if (
    inheritance.masterShape !== undefined &&
    inheritance.masterPart !== null
  ) {
    addShapeFontReference(
      sources,
      inheritance.masterShape,
      inheritance.masterPart,
      "master-font-reference",
    );
  }
  if (inheritance.masterRoot !== undefined && inheritance.masterPart !== null) {
    addProperties(
      sources,
      masterTextStyleProperties(
        inheritance.masterRoot,
        inheritance.placeholderKind,
        level,
      ),
      inheritance.masterPart,
      `master-${inheritance.placeholderKind}-text-style`,
    );
  }
  if (inheritance.presentationRoot !== undefined) {
    addProperties(
      sources,
      presentationDefaultProperties(inheritance.presentationRoot, level),
      inheritance.presentationPart,
      "presentation-default-text-style",
    );
  }
  return sources;
}

function addBodyStyles(
  sources: StyleSource[],
  body: XmlElement,
  level: number | null,
  partName: string,
  sourceKind: string,
  includeParagraphDefaults: boolean,
): void {
  if (level === null) return;
  if (includeParagraphDefaults) {
    addProperties(
      sources,
      bodyParagraphProperties(body, level),
      partName,
      `${sourceKind}-paragraph`,
    );
  }
  const listStyle = directDrawingChild(body, "lstStyle");
  addProperties(
    sources,
    levelProperties(listStyle, level),
    partName,
    sourceKind,
  );
}

function addProperties(
  sources: StyleSource[],
  properties: XmlElement | undefined,
  sourcePart: string,
  sourceKind: string,
): void {
  if (properties !== undefined) {
    sources.push({ properties, sourcePart, sourceKind });
  }
}

function addShapeFontReference(
  sources: StyleSource[],
  shape: ShapeDefinition,
  sourcePart: string,
  sourceKind: string,
): void {
  const style = directPresentationChild(shape.element, "style");
  const fontReference =
    style === undefined ? undefined : directDrawingChild(style, "fontRef");
  const index = attribute(fontReference, "idx");
  if (index === "major" || index === "minor") {
    sources.push({ fontReference: index, sourcePart, sourceKind });
  }
}

function resolveFontSize(
  sources: readonly StyleSource[],
  level: number | null,
): ResolvedValue<number> {
  for (const source of sources) {
    if (source.properties === undefined) continue;
    const raw = attribute(source.properties, "sz");
    if (raw === null) continue;
    const parsed = parseInteger(raw);
    if (parsed === null || parsed < 100 || parsed > 400_000) {
      return unresolved(
        `Invalid OOXML font size ${JSON.stringify(raw)}.`,
        source,
        raw,
      );
    }
    return {
      status: "resolved",
      value: parsed / 100,
      sourcePart: source.sourcePart,
      sourceKind: source.sourceKind,
      rawValue: raw,
    };
  }
  return {
    status: "unresolved",
    reason:
      level === null
        ? "Paragraph level is invalid, so the inherited font size cannot be resolved."
        : "No font size was found in the supported text style chain.",
  };
}

function effectiveFontSize(
  base: ResolvedValue<number>,
  autofit: AutofitState,
): ResolvedValue<number> {
  if (base.status !== "resolved") return base;
  if (autofit.kind === "unknown") {
    return {
      status: "unresolved",
      reason: `Effective font size is unavailable because autofit is unresolved: ${autofit.reason}`,
    };
  }
  if (autofit.kind !== "runtime") return base;
  if (autofit.persistedScaleRatio === undefined) {
    return {
      status: "unresolved",
      reason:
        "Effective font size is unavailable without a usable persisted autofit scale.",
      sourcePart: autofit.sourcePart,
      sourceKind: autofit.sourceKind,
      ...(autofit.rawFontScale === undefined
        ? {}
        : { rawValue: autofit.rawFontScale }),
    };
  }
  return {
    status: "resolved",
    value: base.value * autofit.persistedScaleRatio,
    sourcePart: autofit.sourcePart,
    sourceKind: "persisted-autofit-scale",
    ...(autofit.rawFontScale === undefined
      ? {}
      : { rawValue: autofit.rawFontScale }),
    referencePart: base.sourcePart,
    referenceKind: base.sourceKind,
  };
}

function resolveTypeface(
  slot: TextScriptSlot,
  sources: readonly StyleSource[],
  theme: ThemeContext,
  text: string,
): ResolvedValue<string> {
  const language = textLanguage(sources, slot);
  for (const source of sources) {
    let raw: string | null = null;
    if (source.properties !== undefined) {
      const typeface = directDrawingChild(
        source.properties,
        typefaceElementName(slot),
      );
      if (typeface === undefined) continue;
      raw = attribute(typeface, "typeface");
      if (raw === null || raw.trim() === "") {
        return unresolved(
          `The ${slot} typeface is empty or invalid.`,
          source,
          raw ?? undefined,
        );
      }
    } else if (source.fontReference !== undefined) {
      raw = `+${source.fontReference === "major" ? "mj" : "mn"}-${themeSlotSuffix(slot)}`;
    }
    if (raw === null) continue;
    if (!raw.startsWith("+")) {
      return {
        status: "resolved",
        value: raw,
        sourcePart: source.sourcePart,
        sourceKind: source.sourceKind,
        rawValue: raw,
      };
    }
    return resolveThemeTypeface(raw, slot, source, theme, text, language);
  }
  return {
    status: "unresolved",
    reason: `No ${slot} typeface was found in the supported text style chain.`,
  };
}

function resolveThemeTypeface(
  raw: string,
  slot: TextScriptSlot,
  reference: StyleSource,
  theme: ThemeContext,
  text: string,
  language: string | null,
): ResolvedValue<string> {
  const match = /^\+(mj|mn)-(lt|ea|cs)$/u.exec(raw);
  if (match === null) {
    return unresolved(
      `Unsupported theme font placeholder ${JSON.stringify(raw)}.`,
      reference,
      raw,
    );
  }
  const overridePart = theme.overrideParts[0];
  if (overridePart !== undefined) {
    return {
      status: "unresolved",
      reason: `Theme placeholder ${JSON.stringify(raw)} cannot be resolved safely because a slide or layout theme override is present.`,
      sourcePart: overridePart,
      sourceKind: "theme-override-unsupported",
      rawValue: raw,
    };
  }
  if (theme.root === undefined || theme.partName === null) {
    return unresolved(
      `Theme font placeholder ${JSON.stringify(raw)} has no reachable theme.`,
      reference,
      raw,
    );
  }
  const family = match[1] === "mj" ? "majorFont" : "minorFont";
  const encodedSlot =
    match[2] === "lt"
      ? "latin"
      : match[2] === "ea"
        ? "eastAsian"
        : "complexScript";
  const fontScheme = drawingDescendants(theme.root, "fontScheme")[0];
  const familyElement =
    fontScheme === undefined
      ? undefined
      : directDrawingChild(fontScheme, family);
  const fontElement =
    familyElement === undefined
      ? undefined
      : directDrawingChild(familyElement, typefaceElementName(encodedSlot));
  let typeface = attribute(fontElement, "typeface");
  if (
    (typeface === null || typeface.trim() === "") &&
    familyElement !== undefined &&
    slot !== "latin"
  ) {
    typeface = supplementalThemeTypeface(familyElement, text, slot, language);
  }
  if (typeface === null || typeface.trim() === "") {
    return unresolved(
      `Theme placeholder ${JSON.stringify(raw)} does not resolve to a ${slot} typeface.`,
      reference,
      raw,
    );
  }
  return {
    status: "resolved",
    value: typeface,
    sourcePart: theme.partName,
    sourceKind: `theme-${family === "majorFont" ? "major" : "minor"}-${encodedSlot}`,
    rawValue: raw,
    referencePart: reference.sourcePart,
    referenceKind: reference.sourceKind,
  };
}

function supplementalThemeTypeface(
  family: XmlElement,
  text: string,
  slot: TextScriptSlot,
  language: string | null,
): string | null {
  const scripts = detectedThemeScripts(text, slot, language);
  const supplementalFonts = directDrawingChildren(family, "font");
  const typefaces = scripts.map((script) => {
    const candidates = supplementalFonts
      .filter((font) => attribute(font, "script") === script)
      .map((font) => attribute(font, "typeface"));
    const unique = [
      ...new Set(
        candidates.filter(
          (typeface): typeface is string =>
            typeface !== null && typeface.trim() !== "",
        ),
      ),
    ];
    return candidates.length > 0 &&
      candidates.every(
        (typeface) => typeface !== null && typeface.trim() !== "",
      ) &&
      unique.length === 1
      ? (unique[0] ?? null)
      : null;
  });
  if (typefaces.some((typeface) => typeface === null)) return null;
  const unique = [...new Set(typefaces)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

function resolveAutofit(sources: readonly StyleSource[]): AutofitState {
  for (const source of sources) {
    const bodyProperties = source.properties;
    if (bodyProperties === undefined) continue;
    const choices = childElements(bodyProperties).filter(
      (child) =>
        isDrawingNamespace(child.name.namespaceUri) &&
        ["noAutofit", "normAutofit", "spAutoFit"].includes(
          child.name.localName,
        ),
    );
    if (choices.length === 0) continue;
    if (choices.length !== 1) {
      return {
        kind: "unknown",
        reason: `${source.sourceKind} contains multiple autofit choices.`,
      };
    }
    const choice = choices[0];
    if (choice?.name.localName === "noAutofit") return { kind: "none" };
    if (choice?.name.localName === "spAutoFit") {
      return { kind: "shape-to-fit-text" };
    }
    if (choice?.name.localName !== "normAutofit") {
      return { kind: "unknown", reason: "Autofit choice is unsupported." };
    }
    const rawFontScale = attribute(choice, "fontScale");
    if (rawFontScale === null) {
      return {
        kind: "runtime",
        sourcePart: source.sourcePart,
        sourceKind: source.sourceKind,
        unusableScaleReason: "normAutofit has no persisted fontScale.",
      };
    }
    const ratio = parseFontScaleRatio(rawFontScale);
    if (ratio === null) {
      return {
        kind: "runtime",
        rawFontScale,
        sourcePart: source.sourcePart,
        sourceKind: source.sourceKind,
        unusableScaleReason:
          "normAutofit fontScale must be 1000 through 100000 or a percentage from 1% through 100%.",
      };
    }
    return {
      kind: "runtime",
      persistedScaleRatio: ratio,
      rawFontScale,
      sourcePart: source.sourcePart,
      sourceKind: source.sourceKind,
    };
  }
  return { kind: "none" };
}

function bodySource(
  body: XmlElement,
  sourcePart: string,
  sourceKind: string,
): StyleSource {
  const properties = directDrawingChild(body, "bodyPr");
  return {
    ...(properties === undefined ? {} : { properties }),
    sourcePart,
    sourceKind,
  };
}

function collectShapes(
  root: XmlElement,
  includeHidden = false,
): readonly ShapeDefinition[] {
  const commonSlideData = directPresentationChild(root, "cSld");
  const shapeTree =
    commonSlideData === undefined
      ? undefined
      : directPresentationChild(commonSlideData, "spTree");
  if (shapeTree === undefined) return [];
  const shapes: ShapeDefinition[] = [];
  collectShapeChildren(shapeTree, false, includeHidden, shapes);
  return shapes;
}

function collectShapeChildren(
  container: XmlElement,
  hiddenAncestor: boolean,
  includeHidden: boolean,
  shapes: ShapeDefinition[],
): void {
  for (const element of childElements(container)) {
    const kind = shapeKind(element);
    if (kind === null) continue;
    const hidden = hiddenAncestor || shapeHidden(element, kind) !== false;
    if (kind === "group") {
      collectShapeChildren(element, hidden, includeHidden, shapes);
      continue;
    }
    if (hidden && !includeHidden) continue;
    shapes.push({
      element,
      id: shapeId(element, kind),
      name: shapeName(element, kind),
      kind,
      placeholder: placeholderIdentity(element, kind),
    });
  }
}

function textBodies(shape: ShapeDefinition): readonly XmlElement[] {
  if (shape.kind === "shape" || shape.kind === "connector") {
    const body = directPresentationChild(shape.element, "txBody");
    return body === undefined ? [] : [body];
  }
  if (shape.kind === "graphic-frame") {
    return drawingDescendants(shape.element, "txBody");
  }
  return [];
}

function correspondingBody(
  shape: ShapeDefinition | undefined,
  index: number,
): XmlElement | undefined {
  return shape === undefined ? undefined : textBodies(shape)[index];
}

function matchLayoutPlaceholder(
  shape: ShapeDefinition,
  candidates: readonly ShapeDefinition[],
): ShapeDefinition | undefined {
  if (shape.placeholder === null) return undefined;
  const byIndex = candidates.filter(
    (candidate) => candidate.placeholder?.index === shape.placeholder?.index,
  );
  if (byIndex.length === 1) return byIndex[0];
  const exact = byIndex.filter(
    (candidate) => candidate.placeholder?.type === shape.placeholder?.type,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

function matchMasterPlaceholder(
  shape: ShapeDefinition,
  candidates: readonly ShapeDefinition[],
): ShapeDefinition | undefined {
  const identity = shape.placeholder;
  if (identity === null) return undefined;
  const compatibleTypes = MASTER_PLACEHOLDER_COMPATIBILITY[identity.type] ?? [
    identity.type,
  ];
  const compatible = candidates.filter(
    (candidate) =>
      candidate.placeholder !== null &&
      compatibleTypes.includes(candidate.placeholder.type),
  );
  const exactIndex = compatible.filter(
    (candidate) => candidate.placeholder?.index === identity.index,
  );
  if (exactIndex.length === 1) return exactIndex[0];
  return compatible.length === 1 ? compatible[0] : undefined;
}

function paragraphDefaultProperties(
  paragraph: XmlElement,
): XmlElement | undefined {
  const properties = directDrawingChild(paragraph, "pPr");
  return properties === undefined
    ? undefined
    : directDrawingChild(properties, "defRPr");
}

function bodyParagraphProperties(
  body: XmlElement,
  level: number,
): XmlElement | undefined {
  for (const paragraph of directDrawingChildren(body, "p")) {
    if (paragraphLevel(paragraph) !== level) continue;
    const properties = paragraphDefaultProperties(paragraph);
    if (properties !== undefined) return properties;
  }
  return undefined;
}

function levelProperties(
  listStyle: XmlElement | undefined,
  level: number,
): XmlElement | undefined {
  if (listStyle === undefined || level < 0 || level > 8) return undefined;
  const levelProperties = directDrawingChild(
    listStyle,
    `lvl${String(level + 1)}pPr`,
  );
  return levelProperties === undefined
    ? undefined
    : directDrawingChild(levelProperties, "defRPr");
}

function masterTextStyleProperties(
  master: XmlElement,
  placeholderKind: PlaceholderKind,
  level: number | null,
): XmlElement | undefined {
  if (level === null) return undefined;
  const textStyles = directPresentationChild(master, "txStyles");
  const style =
    textStyles === undefined
      ? undefined
      : directPresentationChild(
          textStyles,
          placeholderKind === "title"
            ? "titleStyle"
            : placeholderKind === "body"
              ? "bodyStyle"
              : "otherStyle",
        );
  return levelProperties(style, level);
}

function presentationDefaultProperties(
  presentation: XmlElement,
  level: number | null,
): XmlElement | undefined {
  if (level === null) return undefined;
  return levelProperties(
    directPresentationChild(presentation, "defaultTextStyle"),
    level,
  );
}

function paragraphLevel(paragraph: XmlElement): number | null {
  const properties = directDrawingChild(paragraph, "pPr");
  const raw = attribute(properties, "lvl");
  if (raw === null) return 0;
  const parsed = parseInteger(raw);
  return parsed !== null && parsed >= 0 && parsed <= 8 ? parsed : null;
}

function classifyPlaceholder(type: string | undefined): PlaceholderKind {
  if (type === "title" || type === "ctrTitle" || type === "vertTitle") {
    return "title";
  }
  if (
    type === "body" ||
    type === "subTitle" ||
    type === "vertBody" ||
    type === "obj"
  ) {
    return "body";
  }
  return "other";
}

function placeholderIdentity(
  shape: XmlElement,
  kind: LocalShapeKind,
): PlaceholderIdentity | null {
  const wrapper = nonVisualWrapper(shape, kind);
  const applicationProperties =
    wrapper === undefined
      ? undefined
      : directPresentationChild(wrapper, "nvPr");
  const placeholder =
    applicationProperties === undefined
      ? undefined
      : directPresentationChild(applicationProperties, "ph");
  if (placeholder === undefined) return null;
  const rawIndex = attribute(placeholder, "idx") ?? "0";
  const parsedIndex = parseInteger(rawIndex);
  if (parsedIndex === null || parsedIndex < 0) return null;
  const type = attribute(placeholder, "type") ?? "obj";
  return type === "" ? null : { index: String(parsedIndex), type };
}

function shapeId(shape: XmlElement, kind: LocalShapeKind): number | null {
  const properties = nonVisualProperties(shape, kind);
  const raw = attribute(properties, "id");
  const parsed = raw === null ? null : parseInteger(raw);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function shapeName(shape: XmlElement, kind: LocalShapeKind): string | null {
  return attribute(nonVisualProperties(shape, kind), "name");
}

function shapeHidden(shape: XmlElement, kind: LocalShapeKind): boolean | null {
  const raw = attribute(nonVisualProperties(shape, kind), "hidden");
  if (raw === null || raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return null;
}

function nonVisualProperties(
  shape: XmlElement,
  kind: LocalShapeKind,
): XmlElement | undefined {
  const wrapper = nonVisualWrapper(shape, kind);
  return wrapper === undefined
    ? undefined
    : directPresentationChild(wrapper, "cNvPr");
}

function nonVisualWrapper(
  shape: XmlElement,
  kind: LocalShapeKind,
): XmlElement | undefined {
  const wrapperName =
    kind === "connector"
      ? "nvCxnSpPr"
      : kind === "content-part"
        ? "nvContentPartPr"
        : kind === "graphic-frame"
          ? "nvGraphicFramePr"
          : kind === "group"
            ? "nvGrpSpPr"
            : kind === "picture"
              ? "nvPicPr"
              : "nvSpPr";
  return directPresentationChild(shape, wrapperName);
}

function shapeKind(element: XmlElement): LocalShapeKind | null {
  if (!isPresentationNamespace(element.name.namespaceUri)) return null;
  switch (element.name.localName) {
    case "cxnSp":
      return "connector";
    case "contentPart":
      return "content-part";
    case "graphicFrame":
      return "graphic-frame";
    case "grpSp":
      return "group";
    case "pic":
      return "picture";
    case "sp":
      return "shape";
    default:
      return null;
  }
}

function usedScriptSlots(text: string): readonly TextScriptSlot[] {
  const slots: TextScriptSlot[] = [];
  const hasEastAsian =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u.test(
      text,
    );
  const hasComplex =
    /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u.test(
      text,
    );
  const withoutSpecialScripts = text.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/gu,
    "",
  );
  if (
    /\p{Letter}/u.test(withoutSpecialScripts) ||
    (!hasEastAsian && !hasComplex && /\p{Number}/u.test(withoutSpecialScripts))
  ) {
    slots.push("latin");
  }
  if (hasEastAsian) slots.push("eastAsian");
  if (hasComplex) slots.push("complexScript");
  return slots.length === 0 ? ["latin"] : slots;
}

function textLanguage(
  sources: readonly StyleSource[],
  slot: TextScriptSlot,
): string | null {
  for (const source of sources) {
    if (source.properties === undefined) continue;
    const attributeNames =
      slot === "eastAsian" ? ["altLang", "lang"] : ["lang", "altLang"];
    const languages: string[] = [];
    for (const attributeName of attributeNames) {
      const language = attribute(source.properties, attributeName);
      if (language !== null && language.trim() !== "") {
        languages.push(language);
      }
    }
    if (slot === "eastAsian") {
      const eastAsianLanguage = languages.find(
        (language) => eastAsianThemeScript(language) !== null,
      );
      if (eastAsianLanguage !== undefined) return eastAsianLanguage;
    }
    if (languages.length > 0) return languages[0] ?? null;
  }
  return null;
}

function detectedThemeScripts(
  text: string,
  slot: TextScriptSlot,
  language: string | null,
): readonly string[] {
  const scripts: string[] = [];
  if (slot === "eastAsian") {
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) {
      scripts.push("Jpan");
    }
    if (/\p{Script=Hangul}/u.test(text)) scripts.push("Hang");
    if (/\p{Script=Bopomofo}/u.test(text)) scripts.push("Hant");
    if (/\p{Script=Han}/u.test(text) && scripts.length === 0) {
      const languageScript = eastAsianThemeScript(language);
      if (languageScript === null) {
        scripts.push("Hans", "Hant");
      } else {
        scripts.push(languageScript);
      }
    }
  } else if (slot === "complexScript") {
    const mappings = [
      ["Arab", /\p{Script=Arabic}/u],
      ["Hebr", /\p{Script=Hebrew}/u],
      ["Syrc", /\p{Script=Syriac}/u],
      ["Thaa", /\p{Script=Thaana}/u],
      ["Deva", /\p{Script=Devanagari}/u],
      ["Beng", /\p{Script=Bengali}/u],
      ["Guru", /\p{Script=Gurmukhi}/u],
      ["Gujr", /\p{Script=Gujarati}/u],
      ["Orya", /\p{Script=Oriya}/u],
      ["Taml", /\p{Script=Tamil}/u],
      ["Telu", /\p{Script=Telugu}/u],
      ["Knda", /\p{Script=Kannada}/u],
      ["Mlym", /\p{Script=Malayalam}/u],
      ["Sinh", /\p{Script=Sinhala}/u],
      ["Thai", /\p{Script=Thai}/u],
      ["Laoo", /\p{Script=Lao}/u],
      ["Tibt", /\p{Script=Tibetan}/u],
      ["Mymr", /\p{Script=Myanmar}/u],
      ["Khmr", /\p{Script=Khmer}/u],
    ] as const;
    for (const [script, pattern] of mappings) {
      if (pattern.test(text)) scripts.push(script);
    }
  }
  return [...new Set(scripts)];
}

function eastAsianThemeScript(language: string | null): string | null {
  if (language === null) return null;
  const normalized = language.toLowerCase();
  if (
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-") ||
    normalized === "zh-cn" ||
    normalized.startsWith("zh-cn-") ||
    normalized === "zh-sg" ||
    normalized.startsWith("zh-sg-")
  ) {
    return "Hans";
  }
  if (
    normalized === "zh-hant" ||
    normalized.startsWith("zh-hant-") ||
    normalized === "zh-tw" ||
    normalized.startsWith("zh-tw-") ||
    normalized === "zh-hk" ||
    normalized.startsWith("zh-hk-") ||
    normalized === "zh-mo" ||
    normalized.startsWith("zh-mo-")
  ) {
    return "Hant";
  }
  if (normalized === "ja" || normalized.startsWith("ja-")) return "Jpan";
  if (normalized === "ko" || normalized.startsWith("ko-")) return "Hang";
  return null;
}

function typefaceElementName(slot: TextScriptSlot): "latin" | "ea" | "cs" {
  return slot === "latin" ? "latin" : slot === "eastAsian" ? "ea" : "cs";
}

function themeSlotSuffix(slot: TextScriptSlot): "lt" | "ea" | "cs" {
  return slot === "latin" ? "lt" : slot === "eastAsian" ? "ea" : "cs";
}

function directPresentationChild(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  return childElements(element).find(
    (child) =>
      isPresentationNamespace(child.name.namespaceUri) &&
      child.name.localName === localName,
  );
}

function directDrawingChild(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  return childElements(element).find((child) =>
    isDrawingElement(child, localName),
  );
}

function directDrawingChildren(
  element: XmlElement,
  localName: string,
): readonly XmlElement[] {
  return childElements(element).filter((child) =>
    isDrawingElement(child, localName),
  );
}

function isDrawingElement(element: XmlElement, localName: string): boolean {
  return (
    isDrawingNamespace(element.name.namespaceUri) &&
    element.name.localName === localName
  );
}

function drawingDescendants(
  element: XmlElement,
  localName: string,
): readonly XmlElement[] {
  return findDescendants(element, DRAWINGML_NAMESPACE, localName).concat(
    findDescendants(element, STRICT_DRAWINGML_NAMESPACE, localName),
  );
}

function isPresentationNamespace(namespaceUri: string | null): boolean {
  return (
    namespaceUri === PRESENTATIONML_NAMESPACE ||
    namespaceUri === STRICT_PRESENTATIONML_NAMESPACE
  );
}

function isDrawingNamespace(namespaceUri: string | null): boolean {
  return (
    namespaceUri === DRAWINGML_NAMESPACE ||
    namespaceUri === STRICT_DRAWINGML_NAMESPACE
  );
}

function textContent(element: XmlElement): string {
  return element.children.map(nodeText).join("");
}

function nodeText(node: XmlNode): string {
  return node.kind === "text" || node.kind === "cdata" ? node.value : "";
}

function attribute(
  element: XmlElement | undefined,
  localName: string,
): string | null {
  return element === undefined
    ? null
    : (getAttribute(element, null, localName)?.value ?? null);
}

function parseInteger(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseFontScaleRatio(value: string): number | null {
  const integer = parseInteger(value);
  if (integer !== null) {
    return integer >= 1_000 && integer <= 100_000 ? integer / 100_000 : null;
  }

  const percentageMatch = /^([0-9]+(?:\.[0-9]+)?)%$/u.exec(value);
  const rawPercentage = percentageMatch?.[1];
  if (rawPercentage === undefined) return null;
  const percentage = Number(rawPercentage);
  return Number.isFinite(percentage) && percentage >= 1 && percentage <= 100
    ? percentage / 100
    : null;
}

function unresolved(
  reason: string,
  source: StyleSource,
  rawValue?: string,
): ResolvedValue<never> {
  return {
    status: "unresolved",
    reason,
    sourcePart: source.sourcePart,
    sourceKind: source.sourceKind,
    ...(rawValue === undefined ? {} : { rawValue }),
  };
}

async function parsedRoot(
  partName: string | null,
  xml: XmlPartStore,
): Promise<XmlElement | undefined> {
  if (partName === null) return undefined;
  const parsed = await xml.get(partName);
  return parsed.ok ? parsed.document.root : undefined;
}
