export { childElements, findDescendants, getAttribute } from "./query.js";
export { createXmlPartStore } from "./xml-part-store.js";
export type {
  XmlPartDiagnostic,
  XmlPartResult,
  XmlPartStore,
  XmlPartStoreStats,
} from "./xml-part-store.js";
export { parseXml } from "./xml-parser.js";
export { XML_NAMESPACE_URI, XMLNS_NAMESPACE_URI } from "./types.js";
export type {
  XmlAttribute,
  XmlComment,
  XmlDocument,
  XmlElement,
  XmlExpandedName,
  XmlNode,
  XmlParseDiagnostic,
  XmlParseDiagnosticCode,
  XmlParseResult,
  XmlProcessingInstruction,
  XmlText,
} from "./types.js";
