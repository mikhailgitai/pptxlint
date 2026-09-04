import type { FindingDraft, PptxLintRule } from "../../lint/rule.js";
import type { XmlPartDiagnostic } from "../../xml/xml-part-store.js";
import { packageRuleDescriptor } from "./shared.js";

const XML_FAILURE_CODES = new Set([
  "dtd-prohibited",
  "invalid-namespace",
  "malformed-xml",
  "unsupported-encoding",
]);

export const malformedXmlRule: PptxLintRule = {
  descriptor: packageRuleDescriptor("package/malformed-xml", [
    "archive",
    "xml",
  ]),
  async analyze(context) {
    const findings: FindingDraft[] = [];
    for (const partName of context.xml.knownXmlParts()) {
      const parsed = await context.xml.get(partName);
      if (parsed.ok || !XML_FAILURE_CODES.has(parsed.diagnostic.code)) continue;
      findings.push(xmlFinding(partName, parsed.diagnostic));
    }
    return findings;
  },
};

function xmlFinding(
  partName: string,
  diagnostic: XmlPartDiagnostic,
): FindingDraft {
  return {
    message: `Package XML part ${JSON.stringify(partName)} cannot be parsed safely.`,
    location: { part: partName },
    evidence: {
      column: diagnostic.column ?? null,
      diagnosticCode: diagnostic.code,
      diagnosticMessage: diagnostic.message,
      line: diagnostic.line ?? null,
      offset: diagnostic.offset ?? null,
      partName,
    },
    fingerprintDiscriminator: partName,
  };
}
