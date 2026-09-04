import {
  RULE_REGISTRY,
  type FindingLocation,
  type LintReport,
  type PptxFinding,
  type RuleId,
  type RuleSeverity,
} from "@pptxlint/core";

import type { CommandReport } from "../report.js";

export const SARIF_VERSION = "2.1.0" as const;
export const SARIF_SCHEMA_URI =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json" as const;

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PARTIAL_FINGERPRINT_NAME = "pptxlintFingerprint/v1";
const SOURCE_ROOT_URI_BASE_ID = "%SRCROOT%";

const RULE_DESCRIPTIONS = {
  "package/broken-relationship":
    "Internal non-media relationship target is missing.",
  "package/missing-media": "Media relationship target is missing.",
  "package/malformed-xml": "Package XML part is not well-formed.",
  "layout/outside-slide": "Shape extends beyond the slide boundary.",
  "layout/text-overlap": "Text-bearing shapes overlap.",
  "layout/text-occluded": "Text is occluded by a later opaque shape.",
  "text/min-font-size": "Effective font size is below the configured minimum.",
  "text/autofit-scale-below-minimum":
    "Stored autofit scale reduces effective font size below the configured minimum.",
  "text/autofit-enabled":
    "Runtime autofit is enabled without a persisted scale.",
  "fonts/allowed": "Resolved font is not in the configured allowlist.",
} as const satisfies Readonly<Record<RuleId, string>>;

export interface SarifLog {
  readonly version: typeof SARIF_VERSION;
  readonly $schema: typeof SARIF_SCHEMA_URI;
  readonly runs: readonly SarifRun[];
}

interface SarifRun {
  readonly tool: {
    readonly driver: {
      readonly name: "pptxlint";
      readonly version: string;
      readonly semanticVersion: string;
      readonly rules: readonly SarifRule[];
    };
  };
  readonly artifacts: readonly SarifArtifact[];
  readonly results: readonly SarifResult[];
  readonly properties: Readonly<Record<string, unknown>>;
}

interface SarifRule {
  readonly id: RuleId;
  readonly shortDescription: { readonly text: string };
  readonly defaultConfiguration: {
    readonly enabled: boolean;
    readonly level: SarifLevel;
  };
  readonly properties: {
    readonly prerequisites: readonly string[];
  };
}

interface SarifArtifact {
  readonly location: {
    readonly uri: string;
    readonly uriBaseId: typeof SOURCE_ROOT_URI_BASE_ID;
    readonly index: number;
  };
  readonly roles: readonly ["analysisTarget"];
  readonly mimeType: typeof PPTX_MIME_TYPE;
  readonly hashes: { readonly "sha-256": string };
  readonly properties: Readonly<Record<string, unknown>>;
}

interface SarifResult {
  readonly ruleId: RuleId;
  readonly ruleIndex: number;
  readonly kind: "fail";
  readonly level: Exclude<SarifLevel, "none">;
  readonly message: { readonly text: string };
  readonly locations: readonly [SarifLocation];
  readonly partialFingerprints: {
    readonly [PARTIAL_FINGERPRINT_NAME]: string;
  };
  readonly properties: Readonly<Record<string, unknown>>;
}

interface SarifLocation {
  readonly physicalLocation: {
    readonly artifactLocation: {
      readonly uri: string;
      readonly uriBaseId: typeof SOURCE_ROOT_URI_BASE_ID;
      readonly index: number;
    };
  };
  readonly logicalLocations: readonly [SarifLogicalLocation];
  readonly properties: Readonly<Record<string, unknown>>;
}

interface SarifLogicalLocation {
  readonly name: string;
  readonly fullyQualifiedName: string;
  readonly kind: "element" | "module" | "resource";
  readonly properties: Readonly<Record<string, unknown>>;
}

type SarifLevel = "error" | "none" | "warning";

export function formatSarif(report: CommandReport): string {
  return `${JSON.stringify(createSarifLog(report), null, 2)}\n`;
}

export function createSarifLog(report: CommandReport): SarifLog {
  const artifacts = report.inputs.map(createArtifact);
  return {
    version: SARIF_VERSION,
    $schema: SARIF_SCHEMA_URI,
    runs: [
      {
        tool: {
          driver: {
            name: "pptxlint",
            version: report.toolVersion,
            semanticVersion: report.toolVersion,
            rules: RULE_REGISTRY.map(({ descriptor }) => ({
              id: descriptor.id,
              shortDescription: {
                text: RULE_DESCRIPTIONS[descriptor.id],
              },
              defaultConfiguration: {
                enabled: descriptor.defaultSeverity !== "off",
                level: sarifDefaultLevel(descriptor.defaultSeverity),
              },
              properties: {
                prerequisites: descriptor.prerequisites,
              },
            })),
          },
        },
        artifacts,
        results: report.inputs.flatMap((input, artifactIndex) =>
          input.findings.map((finding) =>
            createResult(input, finding, artifactIndex, artifacts),
          ),
        ),
        properties: {
          pptxlintReportSchemaVersion: report.schemaVersion,
          pptxlintConfigHash: report.configHash,
          pptxlintAnalysisComplete: report.analysisComplete,
          pptxlintSummary: report.summary,
          pptxlintTimingsMs: report.timingsMs,
          ...(report.peakRssBytes === undefined
            ? {}
            : { pptxlintPeakRssBytes: report.peakRssBytes }),
        },
      },
    ],
  };
}

function createArtifact(report: LintReport, index: number): SarifArtifact {
  return {
    location: {
      uri: artifactUri(report.input.inputKey),
      uriBaseId: SOURCE_ROOT_URI_BASE_ID,
      index,
    },
    roles: ["analysisTarget"],
    mimeType: PPTX_MIME_TYPE,
    hashes: { "sha-256": report.input.sourceSha256 },
    properties: {
      pptxlintInputKey: report.input.inputKey,
      pptxlintDisplayPath: report.input.file,
      pptxlintAnalysisComplete: report.analysisComplete,
      pptxlintSkippedRules: report.skippedRules,
      ...(report.diagnostics.length === 0
        ? {}
        : { pptxlintDiagnostics: report.diagnostics }),
    },
  };
}

function createResult(
  report: LintReport,
  finding: PptxFinding,
  artifactIndex: number,
  artifacts: readonly SarifArtifact[],
): SarifResult {
  const artifact = artifacts[artifactIndex];
  if (artifact === undefined) {
    throw new TypeError("SARIF artifact index is out of bounds.");
  }
  const ruleIndex = RULE_REGISTRY.findIndex(
    ({ descriptor }) => descriptor.id === finding.ruleId,
  );
  if (ruleIndex < 0) {
    throw new TypeError(
      `Unknown SARIF rule ${JSON.stringify(finding.ruleId)}.`,
    );
  }
  const locationProperties = finding.location;
  return {
    ruleId: finding.ruleId,
    ruleIndex,
    kind: "fail",
    level: finding.severity,
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: artifact.location.uri,
            uriBaseId: SOURCE_ROOT_URI_BASE_ID,
            index: artifactIndex,
          },
        },
        logicalLocations: [
          createLogicalLocation(report.input.inputKey, finding.location),
        ],
        properties: { ...locationProperties },
      },
    ],
    partialFingerprints: {
      [PARTIAL_FINGERPRINT_NAME]: finding.fingerprint,
    },
    properties: {
      pptxlintStatus: finding.status,
      pptxlintInputKey: report.input.inputKey,
      ...locationProperties,
      pptxlintEvidence: finding.evidence,
    },
  };
}

function createLogicalLocation(
  inputKey: string,
  location: FindingLocation,
): SarifLogicalLocation {
  const name = logicalLocationName(location);
  return {
    name,
    fullyQualifiedName: `${inputKey}#${logicalLocationIdentity(location)}`,
    kind:
      location.slideNumber !== undefined
        ? "element"
        : location.part !== undefined
          ? "module"
          : "resource",
    properties: { ...location },
  };
}

function logicalLocationName(location: FindingLocation): string {
  const segments: string[] = [];
  if (location.slideNumber !== undefined) {
    segments.push(`slide ${String(location.slideNumber)}`);
  }
  if (location.shapeIds !== undefined && location.shapeIds.length > 0) {
    segments.push(
      `${location.shapeIds.length === 1 ? "shape" : "shapes"} ${location.shapeIds.join(", ")}`,
    );
  }
  if (location.paragraphIndex !== undefined) {
    segments.push(`paragraph ${String(location.paragraphIndex)}`);
  }
  if (location.runIndex !== undefined) {
    segments.push(`run ${String(location.runIndex)}`);
  }
  if (segments.length === 0 && location.part !== undefined) {
    segments.push(`part ${location.part}`);
  }
  return segments.length === 0 ? "package" : segments.join(" / ");
}

function logicalLocationIdentity(location: FindingLocation): string {
  const segments = [
    location.part === undefined ? undefined : `part=${location.part}`,
    location.slideNumber === undefined
      ? undefined
      : `slide=${String(location.slideNumber)}`,
    location.slideId === undefined ? undefined : `slideId=${location.slideId}`,
    location.shapeIds === undefined
      ? undefined
      : `shapeIds=${location.shapeIds.join(",")}`,
    location.paragraphIndex === undefined
      ? undefined
      : `paragraph=${String(location.paragraphIndex)}`,
    location.runIndex === undefined
      ? undefined
      : `run=${String(location.runIndex)}`,
  ].filter((segment): segment is string => segment !== undefined);
  return segments.length === 0 ? "package" : segments.join(";");
}

function artifactUri(inputKey: string): string {
  return inputKey.split("/").map(encodeUriSegment).join("/");
}

function encodeUriSegment(segment: string): string {
  return (segment.match(/%[0-9A-Fa-f]{2}|./gu) ?? [])
    .map((token) =>
      /^%[0-9A-Fa-f]{2}$/u.test(token) ? token : encodeURIComponent(token),
    )
    .join("");
}

function sarifDefaultLevel(severity: RuleSeverity): SarifLevel {
  return severity === "off" ? "none" : severity;
}
