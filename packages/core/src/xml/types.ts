export const XML_NAMESPACE_URI = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NAMESPACE_URI = "http://www.w3.org/2000/xmlns/";

export interface XmlExpandedName {
  readonly qualifiedName: string;
  readonly prefix: string | null;
  readonly localName: string;
  readonly namespaceUri: string | null;
}

export interface XmlAttribute extends XmlExpandedName {
  readonly value: string;
}

export interface XmlElement {
  readonly kind: "element";
  readonly name: XmlExpandedName;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
}

export interface XmlText {
  readonly kind: "text" | "cdata";
  readonly value: string;
}

export interface XmlComment {
  readonly kind: "comment";
  readonly value: string;
}

export interface XmlProcessingInstruction {
  readonly kind: "processing-instruction";
  readonly target: string;
  readonly value: string;
}

export type XmlNode =
  XmlElement | XmlText | XmlComment | XmlProcessingInstruction;

export interface XmlDocument {
  readonly root: XmlElement;
}

export type XmlParseDiagnosticCode =
  | "dtd-prohibited"
  | "invalid-namespace"
  | "malformed-xml"
  | "unsupported-encoding";

export interface XmlParseDiagnostic {
  readonly code: XmlParseDiagnosticCode;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;
}

export type XmlParseResult =
  | { readonly ok: true; readonly document: XmlDocument }
  | { readonly ok: false; readonly diagnostic: XmlParseDiagnostic };
