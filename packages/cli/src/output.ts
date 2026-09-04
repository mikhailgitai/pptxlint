import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { pathsReferToSameFile } from "./file-identity.js";

export interface ProtectedOutputPath {
  readonly label: string;
  readonly path: string;
}

export class OutputFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OutputFileError";
  }
}

export async function assertOutputFileIsDistinct(
  cwd: string,
  outputPath: string,
  inputPaths: readonly string[],
  protectedPaths: readonly ProtectedOutputPath[] = [],
): Promise<void> {
  const absoluteOutputPath = resolve(cwd, outputPath);
  for (const inputPath of inputPaths) {
    if (
      await pathsReferToSameFile(absoluteOutputPath, resolve(cwd, inputPath))
    ) {
      throw new OutputFileError(
        `Output file must not overwrite input ${JSON.stringify(inputPath)}.`,
      );
    }
  }
  for (const protectedPath of protectedPaths) {
    if (
      await pathsReferToSameFile(
        absoluteOutputPath,
        resolve(cwd, protectedPath.path),
      )
    ) {
      throw new OutputFileError(
        `Output file must not overwrite ${protectedPath.label} ${JSON.stringify(protectedPath.path)}.`,
      );
    }
  }
}

export async function writeOutputFile(
  cwd: string,
  outputPath: string,
  contents: string,
  inputPaths: readonly string[],
  protectedPaths: readonly ProtectedOutputPath[] = [],
): Promise<void> {
  const absolutePath = resolve(cwd, outputPath);
  const temporaryPath = join(
    dirname(absolutePath),
    `.pptxlint-output-${randomUUID()}.tmp`,
  );
  let temporaryExists = false;
  try {
    await assertOutputFileIsDistinct(
      cwd,
      outputPath,
      inputPaths,
      protectedPaths,
    );
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertOutputFileIsDistinct(
      cwd,
      outputPath,
      inputPaths,
      protectedPaths,
    );
    await rename(temporaryPath, absolutePath);
    temporaryExists = false;
  } catch (error) {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined);
    }
    throw new OutputFileError(
      `Cannot write output file ${JSON.stringify(outputPath)}: ${errorMessage(error)}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
