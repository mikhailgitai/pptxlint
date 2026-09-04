import type { PptxLintRule } from "../lint/rule.js";
import { allowedFontsRule } from "./fonts/allowed.js";
import { outsideSlideRule } from "./layout/outside-slide.js";
import { textOccludedRule } from "./layout/text-occluded.js";
import { textOverlapRule } from "./layout/text-overlap.js";
import { brokenRelationshipRule } from "./package/broken-relationship.js";
import { malformedXmlRule } from "./package/malformed-xml.js";
import { missingMediaRule } from "./package/missing-media.js";
import { autofitEnabledRule } from "./text/autofit-enabled.js";
import { autofitScaleBelowMinimumRule } from "./text/autofit-scale-below-minimum.js";
import { minFontSizeRule } from "./text/min-font-size.js";

/** Stable execution order for all implemented rules. */
export const RULE_REGISTRY: readonly PptxLintRule[] = [
  brokenRelationshipRule,
  missingMediaRule,
  malformedXmlRule,
  outsideSlideRule,
  textOverlapRule,
  textOccludedRule,
  minFontSizeRule,
  autofitScaleBelowMinimumRule,
  autofitEnabledRule,
  allowedFontsRule,
];
