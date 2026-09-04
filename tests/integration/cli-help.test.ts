import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  buildRawZip,
  minimalPptxEntries,
  minimalSlideXml,
  OFFICE_RELATIONSHIPS_NAMESPACE,
  PACKAGE_RELATIONSHIPS_NAMESPACE,
} from "../../fixtures/builders/index.js";

const execFileAsync = promisify(execFile);
const builtCliPath = resolve("packages/cli/dist/cli.js");

describe("built CLI", () => {
  it("runs the wired binary help", async () => {
    const { stderr, stdout } = await execFileAsync(
      process.execPath,
      [builtCliPath, "--help"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("ESLint for generated PowerPoint.");
    expect(stdout).toContain("@pptxlint/core");
    expect(stderr).toBe("");
  });

  it("reports missing media end-to-end with exit code 1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pptxlint-integration-"));
    try {
      const fixturePath = join(directory, "missing-media.pptx");
      await writeFile(fixturePath, missingMediaPptx());
      await writeFile(
        join(directory, ".pptxlintrc.json"),
        `${JSON.stringify({ schemaVersion: 1, extends: ["recommended"] })}\n`,
      );

      const result = await executeCli(
        ["missing-media.pptx", "--config", ".pptxlintrc.json"],
        directory,
      );

      expect(result.code).toBe(1);
      expect(result.stdout).toContain("package/missing-media");
      expect(result.stdout).toContain("slide 1");
      expect(result.stderr).toBe("");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function executeCli(
  args: readonly string[],
  cwd: string,
): Promise<{
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [builtCliPath, ...args],
      { cwd, encoding: "utf8" },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        resolve({
          code:
            typeof error?.code === "number"
              ? error.code
              : error === null
                ? 0
                : 2,
          stderr,
          stdout,
        });
      },
    );
  });
}

function missingMediaPptx(): Uint8Array {
  const relationships = `<?xml version="1.0"?>
    <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/missing.png"/>
    </Relationships>`;
  return buildRawZip(
    minimalPptxEntries(minimalSlideXml()).map((entry) => ({
      ...entry,
      data:
        entry.name === "ppt/slides/_rels/slide1.xml.rels"
          ? relationships
          : entry.data,
    })),
  );
}
