import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  ConfigError,
  resolveConfig,
  type ResolvedConfig,
  type Severity,
  withFailOn,
} from "@pptxlint/core";

const CONFIG_FILE_NAME = ".pptxlintrc.json";

export interface LoadConfigOptions {
  readonly cwd: string;
  readonly explicitPath?: string;
  readonly failOn?: Severity;
  readonly resolveFileInputKey: (file: string) => string;
}

export interface LoadedConfig {
  readonly config: ResolvedConfig;
  readonly configPath: string | null;
}

export async function loadConfig(
  options: LoadConfigOptions,
): Promise<LoadedConfig> {
  const configPath =
    options.explicitPath === undefined
      ? await discoverConfig(options.cwd)
      : resolve(options.cwd, options.explicitPath);
  let config: ResolvedConfig;
  if (configPath === null) {
    config = resolveConfig();
  } else {
    let source: string;
    try {
      source = await readFile(configPath, "utf8");
    } catch (error) {
      throw new ConfigError(
        `Cannot read config ${JSON.stringify(displayConfigPath(configPath, options.cwd))}: ${errorMessage(error)}`,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(source) as unknown;
    } catch (error) {
      throw new ConfigError(
        `Cannot parse config ${JSON.stringify(displayConfigPath(configPath, options.cwd))}: ${errorMessage(error)}`,
      );
    }
    config = resolveConfig(value, {
      resolveFileInputKey: options.resolveFileInputKey,
    });
  }
  return {
    config:
      options.failOn === undefined
        ? config
        : withFailOn(config, options.failOn),
    configPath,
  };
}

async function discoverConfig(startDirectory: string): Promise<string | null> {
  const directory = resolve(startDirectory);
  const candidate = join(directory, CONFIG_FILE_NAME);
  try {
    await access(candidate);
    return candidate;
  } catch {
    const parent = dirname(directory);
    return parent === directory ? null : discoverConfig(parent);
  }
}

function displayConfigPath(configPath: string, cwd: string): string {
  return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
