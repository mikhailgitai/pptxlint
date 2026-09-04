import type { XmlAttribute, XmlElement, XmlNode } from "./types.js";

export function getAttribute(
  element: XmlElement,
  namespaceUri: string | null,
  localName: string,
): XmlAttribute | undefined {
  return element.attributes.find(
    (attribute) =>
      attribute.namespaceUri === namespaceUri &&
      attribute.localName === localName,
  );
}

export function childElements(element: XmlElement): readonly XmlElement[] {
  return element.children.filter(isXmlElement);
}

export function findDescendants(
  element: XmlElement,
  namespaceUri: string | null,
  localName: string,
): readonly XmlElement[] {
  const matches: XmlElement[] = [];
  for (const child of childElements(element)) {
    if (
      child.name.namespaceUri === namespaceUri &&
      child.name.localName === localName
    ) {
      matches.push(child);
    }
    matches.push(...findDescendants(child, namespaceUri, localName));
  }
  return matches;
}

function isXmlElement(node: XmlNode): node is XmlElement {
  return node.kind === "element";
}
