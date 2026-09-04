import type { ArchiveIndex } from "../archive/archive-index.js";
import type { ContextDiagnostic } from "../context/types.js";
import { resolveSlideGeometry } from "../geometry/shape-geometry.js";
import type { SlideGeometry } from "../geometry/shape-geometry.js";
import {
  isRelationshipType,
  type PackageRelationship,
  type RelationshipGraph,
} from "../relationships/relationships.js";
import { childElements, findDescendants, getAttribute } from "../xml/query.js";
import type { XmlElement } from "../xml/types.js";
import type { XmlPartStore } from "../xml/xml-part-store.js";

export const PRESENTATIONML_NAMESPACE =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
export const STRICT_PRESENTATIONML_NAMESPACE =
  "http://purl.oclc.org/ooxml/presentationml/main";
export const OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const STRICT_OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://purl.oclc.org/ooxml/officeDocument/relationships";
export const DRAWINGML_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
export const STRICT_DRAWINGML_NAMESPACE =
  "http://purl.oclc.org/ooxml/drawingml/main";

export type LocalShapeKind =
  | "connector"
  | "content-part"
  | "graphic-frame"
  | "group"
  | "picture"
  | "shape";

export interface LocalSlideShape {
  readonly id: number | null;
  readonly name: string | null;
  readonly kind: LocalShapeKind;
  /** Sibling order, back to front, within the shape tree or parent group. */
  readonly zIndex: number;
  readonly parentShapeId: number | null;
}

export interface PresentationSlide {
  readonly number: number;
  readonly persistentId: string;
  readonly relationshipId: string;
  readonly partName: string | null;
  readonly layoutPart: string | null;
  readonly masterPart: string | null;
  readonly themePart: string | null;
  readonly shapes: readonly LocalSlideShape[];
  readonly geometry: SlideGeometry;
  readonly available: boolean;
}

export interface PresentationIndex {
  readonly partName: string;
  readonly widthEmu: number | null;
  readonly heightEmu: number | null;
  readonly slides: readonly PresentationSlide[];
}

export interface PresentationIndexResult {
  readonly index: PresentationIndex | null;
  readonly diagnostics: readonly ContextDiagnostic[];
}

export async function buildPresentationIndex(
  archive: ArchiveIndex,
  xml: XmlPartStore,
  relationships: RelationshipGraph,
): Promise<PresentationIndexResult> {
  const diagnostics: ContextDiagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  const add = (diagnostic: ContextDiagnostic): void => {
    const key = `${diagnostic.code}\0${diagnostic.partName ?? ""}\0${diagnostic.relationshipId ?? ""}`;
    if (!seenDiagnostics.has(key)) {
      seenDiagnostics.add(key);
      diagnostics.push(diagnostic);
    }
  };

  const officeDocument = relationships
    .outgoing(null)
    .find((relationship) =>
      isRelationshipType(relationship.type, "officeDocument"),
    );
  if (
    officeDocument === undefined ||
    officeDocument.targetMode === "external"
  ) {
    add(
      diagnostic(
        "missing-office-document",
        "Root relationships do not contain an internal officeDocument target.",
        "_rels/.rels",
      ),
    );
    return { index: null, diagnostics };
  }
  const presentationPart = officeDocument.resolvedTarget;
  if (presentationPart === null || !archive.has(presentationPart)) {
    add(
      diagnostic(
        "missing-presentation-part",
        "The officeDocument relationship target does not exist.",
        "_rels/.rels",
        officeDocument.id,
      ),
    );
    return { index: null, diagnostics };
  }

  const parsedPresentation = await xml.get(presentationPart);
  if (!parsedPresentation.ok) {
    addXmlFailure(add, presentationPart, parsedPresentation.diagnostic.message);
    return { index: null, diagnostics };
  }
  const root = parsedPresentation.document.root;
  if (!isPresentationElement(root, "presentation")) {
    add(
      diagnostic(
        "invalid-presentation",
        "Presentation part has an unexpected root element.",
        presentationPart,
      ),
    );
    return { index: null, diagnostics };
  }

  const size = firstChild(root, "sldSz");
  const widthEmu = parsePositiveInteger(
    size === undefined ? undefined : getAttribute(size, null, "cx")?.value,
  );
  const heightEmu = parsePositiveInteger(
    size === undefined ? undefined : getAttribute(size, null, "cy")?.value,
  );
  if (widthEmu === null || heightEmu === null) {
    add(
      diagnostic(
        "invalid-presentation",
        "Presentation slide dimensions are missing or invalid.",
        presentationPart,
      ),
    );
  }

  const slideIds = firstChild(root, "sldIdLst");
  const slides: PresentationSlide[] = [];
  const elements =
    slideIds === undefined
      ? []
      : childElements(slideIds).filter((element) =>
          isPresentationElement(element, "sldId"),
        );
  for (const [index, element] of elements.entries()) {
    const persistentId = getAttribute(element, null, "id")?.value ?? "";
    const relationshipId = getRelationshipId(element);
    const slideRelationship = relationships.getById(
      presentationPart,
      relationshipId,
    );
    if (
      relationshipId === "" ||
      slideRelationship?.targetMode !== "internal" ||
      !isRelationshipType(slideRelationship.type, "slide")
    ) {
      add(
        diagnostic(
          "missing-presentation-relationship",
          `Slide ${String(index + 1)} does not have a usable relationship.`,
          presentationPart,
          relationshipId === "" ? null : relationshipId,
        ),
      );
      slides.push(emptySlide(index + 1, persistentId, relationshipId));
      continue;
    }
    slides.push(
      await buildSlide(
        index + 1,
        persistentId,
        slideRelationship,
        archive,
        xml,
        relationships,
        add,
      ),
    );
  }

  return {
    index: {
      partName: presentationPart,
      widthEmu,
      heightEmu,
      slides,
    },
    diagnostics,
  };
}

async function buildSlide(
  number: number,
  persistentId: string,
  slideRelationship: PackageRelationship,
  archive: ArchiveIndex,
  xml: XmlPartStore,
  relationships: RelationshipGraph,
  add: (diagnostic: ContextDiagnostic) => void,
): Promise<PresentationSlide> {
  const partName = slideRelationship.resolvedTarget;
  if (partName === null || !archive.has(partName)) {
    add(
      diagnostic(
        "missing-presentation-target",
        `Slide ${String(number)} target does not exist.`,
        slideRelationship.relationshipsPart,
        slideRelationship.id,
      ),
    );
    return emptySlide(number, persistentId, slideRelationship.id, partName);
  }

  const parsed = await xml.get(partName);
  let shapes: readonly LocalSlideShape[] = [];
  let slideRoot: XmlElement | undefined;
  let geometry: SlideGeometry = { shapes: [], unsupported: [] };
  let available = parsed.ok;
  if (parsed.ok) {
    if (isPresentationElement(parsed.document.root, "sld")) {
      slideRoot = parsed.document.root;
      shapes = inventoryShapes(parsed.document.root);
    } else {
      available = false;
      add(
        diagnostic(
          "invalid-presentation",
          "Slide part has an unexpected root element.",
          partName,
        ),
      );
    }
  } else {
    addXmlFailure(add, partName, parsed.diagnostic.message);
  }

  const layoutPart = await followChain(
    partName,
    "slideLayout",
    archive,
    xml,
    relationships,
    add,
  );
  const masterPart =
    layoutPart === null
      ? null
      : await followChain(
          layoutPart,
          "slideMaster",
          archive,
          xml,
          relationships,
          add,
        );
  const themePart =
    masterPart === null
      ? null
      : await followChain(
          masterPart,
          "theme",
          archive,
          xml,
          relationships,
          add,
        );

  if (slideRoot !== undefined) {
    const layoutRoot = await parsedRoot(layoutPart, xml);
    const masterRoot = await parsedRoot(masterPart, xml);
    geometry = resolveSlideGeometry(slideRoot, {
      ...(layoutRoot === undefined ? {} : { layout: layoutRoot }),
      ...(masterRoot === undefined ? {} : { master: masterRoot }),
    });
    const firstUnsupported = geometry.unsupported[0];
    if (firstUnsupported !== undefined) {
      add(
        diagnostic(
          "unsupported-geometry",
          `Slide ${String(number)} has ${String(geometry.unsupported.length)} local shape geometr${geometry.unsupported.length === 1 ? "y" : "ies"} that could not be resolved. First: ${firstUnsupported.reason}`,
          partName,
        ),
      );
    }
  }

  return {
    number,
    persistentId,
    relationshipId: slideRelationship.id,
    partName,
    layoutPart,
    masterPart,
    themePart,
    shapes,
    geometry,
    available,
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

async function followChain(
  sourcePart: string,
  typeName: "slideLayout" | "slideMaster" | "theme",
  archive: ArchiveIndex,
  xml: XmlPartStore,
  relationships: RelationshipGraph,
  add: (diagnostic: ContextDiagnostic) => void,
): Promise<string | null> {
  const relationship = relationships
    .outgoing(sourcePart)
    .find((candidate) => isRelationshipType(candidate.type, typeName));
  if (relationship?.targetMode !== "internal") {
    add(
      diagnostic(
        "missing-presentation-relationship",
        `${JSON.stringify(sourcePart)} has no internal ${typeName} relationship.`,
        sourcePart,
      ),
    );
    return null;
  }
  const target = relationship.resolvedTarget;
  if (target === null || !archive.has(target)) {
    add(
      diagnostic(
        "missing-presentation-target",
        `${typeName} relationship target does not exist.`,
        relationship.relationshipsPart,
        relationship.id,
      ),
    );
    return null;
  }
  const parsed = await xml.get(target);
  if (!parsed.ok) {
    addXmlFailure(add, target, parsed.diagnostic.message);
    return null;
  }
  if (!isExpectedChainRoot(parsed.document.root, typeName)) {
    add(
      diagnostic(
        "invalid-presentation",
        `${typeName} part has an unexpected root element.`,
        target,
      ),
    );
    return null;
  }
  return target;
}

function inventoryShapes(slide: XmlElement): readonly LocalSlideShape[] {
  const commonSlideData = firstChild(slide, "cSld");
  const shapeTree =
    commonSlideData === undefined
      ? undefined
      : firstChild(commonSlideData, "spTree");
  if (shapeTree === undefined) return [];
  return inventoryShapeChildren(shapeTree, null);
}

function inventoryShapeChildren(
  container: XmlElement,
  parentShapeId: number | null,
): readonly LocalSlideShape[] {
  const shapes: LocalSlideShape[] = [];
  let zIndex = 0;
  for (const element of childElements(container)) {
    const kind = shapeKind(element);
    if (kind === null) continue;
    const metadata = findDescendants(
      element,
      element.name.namespaceUri,
      "cNvPr",
    )[0];
    const id = parseNonNegativeInteger(
      metadata === undefined
        ? undefined
        : getAttribute(metadata, null, "id")?.value,
    );
    shapes.push({
      id,
      name:
        metadata === undefined
          ? null
          : (getAttribute(metadata, null, "name")?.value ?? null),
      kind,
      zIndex,
      parentShapeId,
    });
    zIndex += 1;
    if (kind === "group") {
      shapes.push(...inventoryShapeChildren(element, id));
    }
  }
  return shapes;
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

function firstChild(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  return childElements(element).find((child) =>
    isPresentationElement(child, localName),
  );
}

function isPresentationElement(
  element: XmlElement,
  localName: string,
): boolean {
  return (
    isPresentationNamespace(element.name.namespaceUri) &&
    element.name.localName === localName
  );
}

function isPresentationNamespace(namespaceUri: string | null): boolean {
  return (
    namespaceUri === PRESENTATIONML_NAMESPACE ||
    namespaceUri === STRICT_PRESENTATIONML_NAMESPACE
  );
}

function isExpectedChainRoot(
  element: XmlElement,
  typeName: "slideLayout" | "slideMaster" | "theme",
): boolean {
  if (typeName === "theme") {
    return (
      (element.name.namespaceUri === DRAWINGML_NAMESPACE ||
        element.name.namespaceUri === STRICT_DRAWINGML_NAMESPACE) &&
      element.name.localName === "theme"
    );
  }
  return isPresentationElement(
    element,
    typeName === "slideLayout" ? "sldLayout" : "sldMaster",
  );
}

function getRelationshipId(element: XmlElement): string {
  return (
    getAttribute(element, OFFICE_RELATIONSHIPS_NAMESPACE, "id")?.value ??
    getAttribute(element, STRICT_OFFICE_RELATIONSHIPS_NAMESPACE, "id")?.value ??
    ""
  );
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9]+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function emptySlide(
  number: number,
  persistentId: string,
  relationshipId: string,
  partName: string | null = null,
): PresentationSlide {
  return {
    number,
    persistentId,
    relationshipId,
    partName,
    layoutPart: null,
    masterPart: null,
    themePart: null,
    shapes: [],
    geometry: { shapes: [], unsupported: [] },
    available: false,
  };
}

function addXmlFailure(
  add: (diagnostic: ContextDiagnostic) => void,
  partName: string,
  message: string,
): void {
  add(diagnostic("malformed-xml", message, partName));
}

function diagnostic(
  code: ContextDiagnostic["code"],
  message: string,
  partName: string | null,
  relationshipId: string | null = null,
): ContextDiagnostic {
  return { code, message, partName, relationshipId };
}
