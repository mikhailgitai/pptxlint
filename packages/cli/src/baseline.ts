import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BaselineError, parseBaseline, type BaselineV3 } from "@pptxlint/core";

import { pathsReferToSameFile } from "./file-identity.js";

export async function loadBaseline(
  cwd: string,
  baselinePath: string,
): Promise<BaselineV3> {
  const absolutePath = resolve(cwd, baselinePath);
  let source: string;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new BaselineError(
      `Cannot read baseline ${JSON.stringify(baselinePath)}: ${errorMessage(error)}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new BaselineError(
      `Cannot parse baseline ${JSON.stringify(baselinePath)}: ${errorMessage(error)}`,
    );
  }
  return parseBaseline(value);
}

export async function writeBaseline(
  cwd: string,
  baselinePath: string,
  baseline: BaselineV3,
  inputPaths: readonly string[],
): Promise<void> {
  const absolutePath = resolve(cwd, baselinePath);
  const temporaryPath = join(
    dirname(absolutePath),
    `.pptxlint-${randomUUID()}.tmp`,
  );
  let temporaryExists = false;
  try {
    await assertBaselineOutputIsDistinct(cwd, baselinePath, inputPaths);
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(`${JSON.stringify(baseline, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertBaselineOutputIsDistinct(cwd, baselinePath, inputPaths);
    await rename(temporaryPath, absolutePath);
    temporaryExists = false;
  } catch (error) {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined);
    }
    throw new BaselineError(
      `Cannot write baseline ${JSON.stringify(baselinePath)}: ${errorMessage(error)}`,
    );
  }
}

export async function assertBaselineOutputIsDistinct(
  cwd: string,
  baselinePath: string,
  inputPaths: readonly string[],
): Promise<void> {
  const outputPath = resolve(cwd, baselinePath);
  for (const inputPath of inputPaths) {
    if (await pathsReferToSameFile(outputPath, resolve(cwd, inputPath))) {
      throw new BaselineError(
        `Baseline output must not overwrite input ${JSON.stringify(inputPath)}.`,
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
