import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep as pathSeparator,
} from "node:path";

import {
  BaselineError,
  ConfigError,
  createBaseline,
  determineExitCode,
  encodeInputKeyPath,
  lintPptx,
  type LintReport,
  type LintTimingName,
  type Severity,
  UnsupportedInputError,
} from "@pptxlint/core";

import {
  assertBaselineOutputIsDistinct,
  loadBaseline,
  writeBaseline,
} from "./baseline.js";
import { HELP_TEXT } from "./commands/help.js";
import { loadConfig } from "./config.js";
import { formatJson } from "./formatters/json.js";
import { formatSarif } from "./formatters/sarif.js";
import { formatStylish } from "./formatters/stylish.js";
import {
  assertOutputFileIsDistinct,
  OutputFileError,
  type ProtectedOutputPath,
  writeOutputFile,
} from "./output.js";
import {
  createConfigHash,
  createCommandReport,
  TOOL_VERSION,
  type CommandReport,
} from "./report.js";

export interface CliIo {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
}

type OutputFormat = "json" | "sarif" | "stylish";

export interface CliRuntime {
  readonly cwd?: string;
}

interface ParsedArguments {
  readonly baselinePath?: string;
  readonly configPath?: string;
  readonly debug: boolean;
  readonly failOn?: Severity;
  readonly format: OutputFormat;
  readonly inputPaths: readonly string[];
  readonly outputFilePath?: string;
  readonly writeBaselinePath?: string;
}

class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
  runtime: CliRuntime = {},
): Promise<0 | 1 | 2> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    io.stdout.write(`${TOOL_VERSION}\n`);
    return 0;
  }

  const cwd = runtime.cwd ?? process.cwd();
  try {
    const parsed = parseArguments(args);
    if (parsed.writeBaselinePath !== undefined) {
      await assertBaselineOutputIsDistinct(
        cwd,
        parsed.writeBaselinePath,
        parsed.inputPaths,
      );
    }
    const loadedConfig = await loadConfig({
      cwd,
      ...(parsed.configPath === undefined
        ? {}
        : { explicitPath: parsed.configPath }),
      ...(parsed.failOn === undefined ? {} : { failOn: parsed.failOn }),
      resolveFileInputKey: (file) => suppressionFileInputKey(file, cwd),
    });
    const { config } = loadedConfig;
    const protectedOutputPaths = outputProtectedPaths(
      parsed,
      loadedConfig.configPath,
    );
    if (parsed.outputFilePath !== undefined) {
      await assertOutputFileIsDistinct(
        cwd,
        parsed.outputFilePath,
        parsed.inputPaths,
        protectedOutputPaths,
      );
    }
    const baseline =
      parsed.baselinePath === undefined
        ? undefined
        : await loadBaseline(cwd, parsed.baselinePath);
    let exitCode: 0 | 1 | 2 = 0;
    const reports: LintReport[] = [];
    const timings = new Map<string, number>();
    const analysisStartedAt = parsed.debug ? performance.now() : 0;
    const onTiming = parsed.debug
      ? (name: LintTimingName, milliseconds: number): void => {
          const key = name === "context" ? name : `rule/${name}`;
          timings.set(key, (timings.get(key) ?? 0) + milliseconds);
        }
      : undefined;
    for (const inputPath of parsed.inputPaths) {
      ensurePptxExtension(inputPath);
      const { absolutePath, displayPath, inputKey } = portableInputIdentity(
        inputPath,
        cwd,
      );
      let bytes: Uint8Array;
      try {
        bytes = await readFile(absolutePath);
      } catch (error) {
        throw new CliUsageError(
          `Cannot read input ${JSON.stringify(inputPath)}: ${errorMessage(error)}`,
        );
      }
      const report = await lintPptx(
        { bytes, displayPath, inputKey },
        {
          config,
          ...(baseline === undefined ? {} : { baseline }),
          ...(onTiming === undefined ? {} : { onTiming }),
        },
      );
      reports.push(report);
      exitCode = Math.max(
        exitCode,
        determineExitCode(report, config.failOn),
      ) as 0 | 1 | 2;
    }
    if (parsed.debug) {
      timings.set("analysis", performance.now() - analysisStartedAt);
    }
    const commandReport = createCommandReport(reports, {
      configHash: createConfigHash(config),
      ...(parsed.debug
        ? {
            timingsMs: Object.fromEntries(timings),
            peakRssBytes: peakRssBytes(),
          }
        : {}),
    });
    const output = formatOutput(commandReport, parsed.format);
    if (parsed.outputFilePath === undefined) {
      if (output !== "") io.stdout.write(output);
    } else {
      await writeOutputFile(
        cwd,
        parsed.outputFilePath,
        output,
        parsed.inputPaths,
        protectedOutputPaths,
      );
    }
    if (exitCode === 2) {
      io.stderr.write(
        "pptxlint: analysis was incomplete and not fully explained by gating package findings.\n",
      );
    }
    if (parsed.writeBaselinePath !== undefined && exitCode !== 2) {
      await writeBaseline(
        cwd,
        parsed.writeBaselinePath,
        createBaseline(reports),
        parsed.inputPaths,
      );
    }
    return exitCode;
  } catch (error) {
    if (
      error instanceof CliUsageError ||
      error instanceof BaselineError ||
      error instanceof ConfigError ||
      error instanceof OutputFileError ||
      error instanceof UnsupportedInputError
    ) {
      io.stderr.write(`pptxlint: ${error.message}\n`);
      return 2;
    }
    io.stderr.write(`pptxlint: internal error: ${errorMessage(error)}\n`);
    return 2;
  }
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const inputPaths: string[] = [];
  let baselinePath: string | undefined;
  let configPath: string | undefined;
  let debug = false;
  let failOn: Severity | undefined;
  let format: OutputFormat = "stylish";
  let formatSpecified = false;
  let outputFilePath: string | undefined;
  let writeBaselinePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--debug") {
      if (debug) {
        throw new CliUsageError("--debug may only be specified once.");
      }
      debug = true;
    } else if (argument === "--baseline") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliUsageError("--baseline requires a path.");
      }
      if (baselinePath !== undefined) {
        throw new CliUsageError("--baseline may only be specified once.");
      }
      baselinePath = value;
      index += 1;
    } else if (argument === "--write-baseline") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliUsageError("--write-baseline requires a path.");
      }
      if (writeBaselinePath !== undefined) {
        throw new CliUsageError("--write-baseline may only be specified once.");
      }
      writeBaselinePath = value;
      index += 1;
    } else if (argument === "--config") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliUsageError("--config requires a path.");
      }
      configPath = value;
      index += 1;
    } else if (argument === "--fail-on") {
      const value = args[index + 1];
      if (value !== "warning" && value !== "error") {
        throw new CliUsageError(
          '--fail-on must be either "warning" or "error".',
        );
      }
      failOn = value;
      index += 1;
    } else if (argument === "--format") {
      const value = args[index + 1];
      if (value !== "stylish" && value !== "json" && value !== "sarif") {
        throw new CliUsageError(
          '--format must be "stylish", "json", or "sarif".',
        );
      }
      if (formatSpecified) {
        throw new CliUsageError("--format may only be specified once.");
      }
      format = value;
      formatSpecified = true;
      index += 1;
    } else if (argument === "--output-file") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliUsageError("--output-file requires a path.");
      }
      if (outputFilePath !== undefined) {
        throw new CliUsageError("--output-file may only be specified once.");
      }
      outputFilePath = value;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new CliUsageError(`Unknown option ${JSON.stringify(argument)}.`);
    } else if (argument !== undefined) {
      inputPaths.push(argument);
    }
  }
  if (inputPaths.length === 0) {
    throw new CliUsageError("At least one .pptx input path is required.");
  }
  if (baselinePath !== undefined && writeBaselinePath !== undefined) {
    throw new CliUsageError(
      "--baseline and --write-baseline cannot be used together.",
    );
  }
  if (debug && format === "stylish") {
    throw new CliUsageError(
      "--debug requires --format json or --format sarif.",
    );
  }
  return {
    ...(baselinePath === undefined ? {} : { baselinePath }),
    ...(configPath === undefined ? {} : { configPath }),
    debug,
    ...(failOn === undefined ? {} : { failOn }),
    format,
    inputPaths,
    ...(outputFilePath === undefined ? {} : { outputFilePath }),
    ...(writeBaselinePath === undefined ? {} : { writeBaselinePath }),
  };
}

function peakRssBytes(): number {
  return Math.max(
    process.memoryUsage.rss(),
    Math.round(process.resourceUsage().maxRSS * 1024),
  );
}

function formatOutput(report: CommandReport, format: OutputFormat): string {
  if (format === "json") return formatJson(report);
  if (format === "sarif") return formatSarif(report);
  return formatStylish(report);
}

function outputProtectedPaths(
  parsed: ParsedArguments,
  configPath: string | null,
): readonly ProtectedOutputPath[] {
  return [
    ...(configPath === null ? [] : [{ label: "config", path: configPath }]),
    ...(parsed.baselinePath === undefined
      ? []
      : [{ label: "baseline", path: parsed.baselinePath }]),
    ...(parsed.writeBaselinePath === undefined
      ? []
      : [{ label: "baseline output", path: parsed.writeBaselinePath }]),
  ];
}

function ensurePptxExtension(inputPath: string): void {
  if (extname(inputPath).toLowerCase() !== ".pptx") {
    throw new CliUsageError(
      `Unsupported input ${JSON.stringify(inputPath)}; expected a .pptx file.`,
    );
  }
}

function portableInputIdentity(
  inputPath: string,
  cwd: string,
): {
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly inputKey: string;
} {
  const absolutePath = resolve(cwd, inputPath);
  const displayPath = portableDisplayPath(absolutePath, cwd);
  return {
    absolutePath,
    displayPath,
    inputKey: portableInputKey(absolutePath, cwd, displayPath),
  };
}

function suppressionFileInputKey(file: string, cwd: string): string {
  if (isAbsolute(file)) {
    throw new CliUsageError("Suppression file selector must be relative.");
  }
  return portableInputIdentity(file, cwd).inputKey;
}

function portableDisplayPath(absolutePath: string, cwd: string): string {
  const candidate = relative(cwd, absolutePath);
  const displayPath = isOutsideWorkingDirectory(candidate)
    ? basename(absolutePath)
    : candidate;
  return normalizePlatformSeparators(displayPath);
}

function portableInputKey(
  absolutePath: string,
  cwd: string,
  displayPath: string,
): string {
  const candidate = relative(cwd, absolutePath);
  const logicalPath = encodeInputKeyPath(candidate, pathSeparator);
  if (!isOutsideWorkingDirectory(candidate)) return logicalPath;
  if (isAbsolute(candidate)) {
    throw new CliUsageError(
      `Cannot derive a portable input key for ${JSON.stringify(displayPath)} across filesystem volumes.`,
    );
  }
  const digest = createHash("sha256").update(logicalPath).digest("hex");
  return `external/${digest}/${encodeInputKeyPath(basename(absolutePath), pathSeparator)}`;
}

function isOutsideWorkingDirectory(candidate: string): boolean {
  return (
    candidate === ".." ||
    candidate.startsWith(`..${pathSeparator}`) ||
    isAbsolute(candidate)
  );
}

function normalizePlatformSeparators(path: string): string {
  return path.split(pathSeparator).join("/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { formatJson } from "./formatters/json.js";
export {
  createSarifLog,
  formatSarif,
  SARIF_SCHEMA_URI,
  SARIF_VERSION,
} from "./formatters/sarif.js";
export type { SarifLog } from "./formatters/sarif.js";
export { formatStylish } from "./formatters/stylish.js";
export {
  COMMAND_REPORT_SCHEMA_VERSION,
  createConfigHash,
  createCommandReport,
  TOOL_VERSION,
} from "./report.js";
export type { CommandReport } from "./report.js";
export type { CreateCommandReportOptions } from "./report.js";
