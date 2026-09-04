import { CORE_PACKAGE_NAME } from "@pptxlint/core";
import { TOOL_VERSION } from "../report.js";

export const HELP_TEXT = `pptxlint ${TOOL_VERSION}

ESLint for generated PowerPoint.

Usage:
  pptxlint [options] <file.pptx> [...files]

Options:
  --config <path>          Use an explicit JSON config
  --format <format>        Use stylish, json, or sarif (default: stylish)
  --output-file <path>     Write output to a file instead of stdout
  --fail-on <severity>     Gate on warning or error (default: error)
  --baseline <path>        Compare findings with a baseline
  --write-baseline <path>  Write an exact baseline after suppressions
  --debug                  Add timings/RSS to JSON or SARIF metadata
  -h, --help               Show this help message
  -v, --version            Show the version

Rules: package integrity, off-slide geometry, and overlapping text frames.
Workspace core: ${CORE_PACKAGE_NAME}.
`;
