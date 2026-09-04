import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep as pathSeparator } from "node:path";

import * as AjvDraft04Module from "ajv-draft-04";
import * as addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMinimalPptx,
  buildRawZip,
  minimalPptxEntries,
  minimalSlideXml,
  OFFICE_RELATIONSHIPS_NAMESPACE,
  PACKAGE_RELATIONSHIPS_NAMESPACE,
} from "../../../fixtures/builders/index.js";
import { RULE_IDS } from "@pptxlint/core";

import { runCli } from "../src/index.js";

interface SchemaCompiler {
  compile(schema: object): ValidateFunction;
}

const AjvDraft04 = AjvDraft04Module.default as unknown as new (options: {
  readonly strict: boolean;
  readonly strictRequired: boolean;
}) => SchemaCompiler;
const addFormats = addFormatsModule.default as unknown as (
  compiler: SchemaCompiler,
) => SchemaCompiler;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function createIo() {
  const stdoutChunks: string[] = [];
  return {
    stderr: { write: vi.fn(() => true) },
    stdout: {
      write: vi.fn((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }),
    },
    stdoutText: () => stdoutChunks.join(""),
  };
}

describe("CLI workspace skeleton", () => {
  it("prints help and exits successfully", async () => {
    const io = createIo();

    await expect(runCli(["--help"], io)).resolves.toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
    );
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("lints a PPTX and prints a stylish package finding", async () => {
    const directory = await temporaryDirectory();
    const file = "missing-media.pptx";
    await writeFile(join(directory, file), missingMediaPptx());
    const io = createIo();

    await expect(runCli([file], io, { cwd: directory })).resolves.toBe(1);
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("package/missing-media"),
    );
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("slide 1"),
    );
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("returns zero for a valid minimal PPTX", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "valid.pptx"), buildMinimalPptx());
    const io = createIo();

    await expect(runCli(["valid.pptx"], io, { cwd: directory })).resolves.toBe(
      0,
    );
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("emits one deterministic multi-file JSON report that matches its schema", async () => {
    const directory = await temporaryDirectory();
    await Promise.all([
      writeFile(join(directory, "z-valid.pptx"), buildMinimalPptx()),
      writeFile(join(directory, "a-missing.pptx"), missingMediaPptx()),
    ]);

    const reversedIo = createIo();
    await expect(
      runCli(
        ["z-valid.pptx", "a-missing.pptx", "--format", "json"],
        reversedIo,
        { cwd: directory },
      ),
    ).resolves.toBe(1);
    const orderedIo = createIo();
    await expect(
      runCli(
        ["a-missing.pptx", "z-valid.pptx", "--format", "json"],
        orderedIo,
        { cwd: directory },
      ),
    ).resolves.toBe(1);

    expect(reversedIo.stdout.write).toHaveBeenCalledTimes(1);
    expect(reversedIo.stdoutText()).toBe(orderedIo.stdoutText());
    const output = reversedIo.stdoutText();
    const report = JSON.parse(output) as {
      readonly inputs: readonly { readonly input: { readonly file: string } }[];
      readonly summary: {
        readonly errors: number;
        readonly total: number;
        readonly warnings: number;
      };
    };
    expect(report.inputs.map(({ input }) => input.file)).toEqual([
      "a-missing.pptx",
      "z-valid.pptx",
    ]);
    expect(report.summary).toMatchObject({
      errors: 1,
      total: 1,
      warnings: 0,
    });

    const schema = JSON.parse(
      await readFile(
        join(process.cwd(), "schemas/pptxlint-report.schema.json"),
        "utf8",
      ),
    ) as object;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(report), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    );
    expect(output).toMatchSnapshot();
    expect(reversedIo.stderr.write).not.toHaveBeenCalled();
  });

  it("adds aggregate rule timings and peak RSS only in debug metadata", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "valid.pptx"), buildMinimalPptx());
    const io = createIo();

    await expect(
      runCli(["valid.pptx", "--format", "json", "--debug"], io, {
        cwd: directory,
      }),
    ).resolves.toBe(0);
    const report = JSON.parse(io.stdoutText()) as {
      readonly peakRssBytes: number;
      readonly timingsMs: Readonly<Record<string, number>>;
    };

    expect(report.peakRssBytes).toBeGreaterThan(0);
    expect(report.timingsMs.analysis).toBeTypeOf("number");
    expect(report.timingsMs.context).toBeTypeOf("number");
    expect(report.timingsMs["rule/layout/text-overlap"]).toBeTypeOf("number");
    expect(report.timingsMs["rule/fonts/allowed"]).toBeUndefined();
    expect(io.stdoutText()).not.toContain(directory);
    expect(io.stderr.write).not.toHaveBeenCalled();

    const schema = JSON.parse(
      await readFile(
        join(process.cwd(), "schemas/pptxlint-report.schema.json"),
        "utf8",
      ),
    ) as object;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(report), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    );
  });

  it("rejects debug metadata with stylish output", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "valid.pptx"), buildMinimalPptx());
    const io = createIo();

    await expect(
      runCli(["valid.pptx", "--debug"], io, { cwd: directory }),
    ).resolves.toBe(2);
    expect(io.stdout.write).not.toHaveBeenCalled();
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining(
        "--debug requires --format json or --format sarif",
      ),
    );
  });

  it("redacts slide text and absolute paths from default JSON output", async () => {
    const directory = await temporaryDirectory();
    const secretText = "CUSTOMER_SECRET_7b0d6d";
    const slideXml = minimalSlideXml().replace(
      "</p:spTree>",
      `<p:sp>
        <p:nvSpPr><p:cNvPr id="42" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="800"/><a:t>${secretText}</a:t></a:r></a:p></p:txBody>
      </p:sp></p:spTree>`,
    );
    await writeFile(
      join(directory, "private.pptx"),
      buildMinimalPptx({ slideXml }),
    );
    const io = createIo();

    await expect(
      runCli(["private.pptx", "--format", "json"], io, { cwd: directory }),
    ).resolves.toBe(1);
    expect(io.stdoutText()).not.toContain(secretText);
    expect(io.stdoutText()).not.toContain(directory);
    expect(io.stdoutText()).toContain("text/min-font-size");
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("emits deterministic multi-file SARIF with rules, artifacts, and logical locations", async () => {
    const directory = await temporaryDirectory();
    await Promise.all([
      writeFile(join(directory, "z-valid.pptx"), buildMinimalPptx()),
      writeFile(join(directory, "a missing#.pptx"), missingMediaPptx()),
    ]);

    const reversedIo = createIo();
    await expect(
      runCli(
        ["z-valid.pptx", "a missing#.pptx", "--format", "sarif"],
        reversedIo,
        { cwd: directory },
      ),
    ).resolves.toBe(1);
    const orderedIo = createIo();
    await expect(
      runCli(
        ["a missing#.pptx", "z-valid.pptx", "--format", "sarif"],
        orderedIo,
        { cwd: directory },
      ),
    ).resolves.toBe(1);

    expect(reversedIo.stdout.write).toHaveBeenCalledTimes(1);
    expect(reversedIo.stdoutText()).toBe(orderedIo.stdoutText());
    expect(reversedIo.stdoutText()).not.toContain("\u001B[");
    const output = reversedIo.stdoutText();
    expect(output).not.toContain(directory);
    const sarif = JSON.parse(output) as {
      readonly runs: readonly {
        readonly artifacts: readonly {
          readonly location: { readonly uri: string };
        }[];
        readonly results: readonly {
          readonly locations: readonly {
            readonly logicalLocations: readonly {
              readonly properties: {
                readonly slideNumber?: number;
              };
            }[];
          }[];
          readonly partialFingerprints: Readonly<Record<string, string>>;
        }[];
        readonly tool: {
          readonly driver: {
            readonly rules: readonly { readonly id: string }[];
          };
        };
      }[];
      readonly version: string;
    };
    const run = sarif.runs[0];
    expect(run).toBeDefined();
    expect(run?.tool.driver.rules.map(({ id }) => id)).toEqual(RULE_IDS);
    expect(run?.artifacts.map(({ location }) => location.uri)).toEqual([
      "a%20missing%23.pptx",
      "z-valid.pptx",
    ]);
    expect(run?.results).toHaveLength(1);
    expect(run?.results[0]).toMatchObject({
      locations: [
        {
          logicalLocations: [{ properties: { slideNumber: 1 } }],
        },
      ],
    });
    expect(run?.results[0]).not.toHaveProperty("baselineState");
    expect(
      run?.results[0]?.partialFingerprints["pptxlintFingerprint/v1"],
    ).toMatch(/^[a-f0-9]{64}$/u);

    const schema = JSON.parse(
      await readFile(
        join(process.cwd(), "schemas/sarif-2.1.0.schema.json"),
        "utf8",
      ),
    ) as object;
    const ajv = new AjvDraft04({ strict: true, strictRequired: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(sarif), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    );
    expect(output).toMatchSnapshot();
    expect(reversedIo.stderr.write).not.toHaveBeenCalled();
  });

  it("writes JSON to --output-file without mixing it into stdout", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "valid.pptx"), buildMinimalPptx());
    const io = createIo();

    await expect(
      runCli(
        [
          "valid.pptx",
          "--format",
          "json",
          "--output-file",
          "reports/pptxlint.json",
        ],
        io,
        { cwd: directory },
      ),
    ).resolves.toBe(2);
    expect(io.stdout.write).not.toHaveBeenCalled();
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Cannot write output file"),
    );

    await mkdir(join(directory, "reports"));
    const successfulIo = createIo();
    await expect(
      runCli(
        [
          "valid.pptx",
          "--format",
          "json",
          "--output-file",
          "reports/pptxlint.json",
        ],
        successfulIo,
        { cwd: directory },
      ),
    ).resolves.toBe(0);
    expect(successfulIo.stdout.write).not.toHaveBeenCalled();
    expect(successfulIo.stderr.write).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        await readFile(join(directory, "reports/pptxlint.json"), "utf8"),
      ),
    ).toMatchObject({
      schemaVersion: 1,
      inputs: [{ input: { file: "valid.pptx" } }],
      summary: { total: 0 },
    });
  });

  it("writes SARIF to --output-file without mixing it into stdout", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "reports"));
    await writeFile(join(directory, "valid.pptx"), buildMinimalPptx());
    const io = createIo();

    await expect(
      runCli(
        [
          "valid.pptx",
          "--format",
          "sarif",
          "--output-file",
          "reports/pptxlint.sarif",
        ],
        io,
        { cwd: directory },
      ),
    ).resolves.toBe(0);
    expect(io.stdout.write).not.toHaveBeenCalled();
    expect(io.stderr.write).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        await readFile(join(directory, "reports/pptxlint.sarif"), "utf8"),
      ),
    ).toMatchObject({
      version: "2.1.0",
      runs: [{ artifacts: [{}], results: [] }],
    });
  });

  it("does not overwrite an input through --output-file", async () => {
    const directory = await temporaryDirectory();
    const input = Buffer.from(buildMinimalPptx());
    await writeFile(join(directory, "valid.pptx"), input);
    const io = createIo();

    await expect(
      runCli(
        ["valid.pptx", "--format", "json", "--output-file", "valid.pptx"],
        io,
        { cwd: directory },
      ),
    ).resolves.toBe(2);
    expect(await readFile(join(directory, "valid.pptx"))).toEqual(input);
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("must not overwrite input"),
    );
  });

  it.each([
    {
      name: "working-directory config",
      outputFile: ".pptxlintrc.json",
      workingDirectory: "config-directory",
    },
    {
      name: "discovered parent config",
      outputFile: "../.pptxlintrc.json",
      workingDirectory: "config-directory/work",
    },
  ])(
    "does not overwrite the $name through --output-file",
    async ({ outputFile, workingDirectory }) => {
      const directory = await temporaryDirectory();
      const configDirectory = join(directory, "config-directory");
      const cwd = join(directory, workingDirectory);
      await mkdir(cwd, { recursive: true });
      const configPath = join(configDirectory, ".pptxlintrc.json");
      const configText = `${JSON.stringify({ extends: ["recommended"] }, null, 2)}\n`;
      await writeFile(configPath, configText);
      await writeFile(join(cwd, "valid.pptx"), buildMinimalPptx());
      const io = createIo();

      await expect(
        runCli(
          ["valid.pptx", "--format", "json", "--output-file", outputFile],
          io,
          { cwd },
        ),
      ).resolves.toBe(2);
      expect(await readFile(configPath, "utf8")).toBe(configText);
      expect(io.stdout.write).not.toHaveBeenCalled();
      expect(io.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("must not overwrite config"),
      );
    },
  );

  it("normalizes a readable relative path before deriving the input key", async () => {
    const directory = await temporaryDirectory();
    const workingDirectory = join(directory, "work");
    await mkdir(workingDirectory);
    await writeFile(join(directory, "deck.pptx"), buildMinimalPptx());
    const io = createIo();

    await expect(
      runCli(["subdir/../../deck.pptx"], io, { cwd: workingDirectory }),
    ).resolves.toBe(0);
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("validates config before reading input files", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "invalid.json"),
      JSON.stringify({ rules: { "unknown/rule": "error" } }),
    );
    const io = createIo();

    await expect(
      runCli(["missing.pptx", "--config", "invalid.json"], io, {
        cwd: directory,
      }),
    ).resolves.toBe(2);
    expect(io.stdout.write).not.toHaveBeenCalled();
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Unknown rule"),
    );
  });

  it("describes code 2 when a gating finding leaves diagnostics uncovered", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "incomplete.pptx"),
      missingMediaPptx({ duplicateXmlContentType: true }),
    );
    const io = createIo();

    await expect(
      runCli(["incomplete.pptx"], io, { cwd: directory }),
    ).resolves.toBe(2);
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("package/missing-media"),
    );
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("not fully explained"),
    );
  });

  it("writes a deterministic baseline and classifies lifecycle changes", async () => {
    const directory = await temporaryDirectory();
    const deckPath = join(directory, "legacy.pptx");
    const baselineFile = "baseline.json";
    await writeFile(deckPath, missingMediaPptx());

    const writeIo = createIo();
    await expect(
      runCli(["legacy.pptx", "--write-baseline", baselineFile], writeIo, {
        cwd: directory,
      }),
    ).resolves.toBe(1);
    const baselineText = await readFile(join(directory, baselineFile), "utf8");
    const baselineValue = JSON.parse(baselineText) as {
      readonly inputs: readonly {
        readonly findings: readonly Record<string, unknown>[];
      }[];
    };
    expect(baselineValue).toMatchObject({
      schemaVersion: 3,
      toolMajorVersion: 0,
      inputs: [{ inputKey: "legacy.pptx", findings: [{}] }],
    });
    expect(baselineValue.inputs[0]?.findings[0]).not.toHaveProperty("status");
    expect(baselineText).not.toContain(directory);
    expect(baselineText).not.toContain("Referenced image");

    const unchangedIo = createIo();
    await expect(
      runCli(["legacy.pptx", "--baseline", baselineFile], unchangedIo, {
        cwd: directory,
      }),
    ).resolves.toBe(0);
    expect(unchangedIo.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 existing"),
    );
    expect(unchangedIo.stdout.write).not.toHaveBeenCalledWith(
      expect.stringContaining("package/missing-media"),
    );
    const unchangedSarifIo = createIo();
    await expect(
      runCli(
        ["legacy.pptx", "--baseline", baselineFile, "--format", "sarif"],
        unchangedSarifIo,
        { cwd: directory },
      ),
    ).resolves.toBe(0);
    const unchangedSarif = JSON.parse(unchangedSarifIo.stdoutText()) as {
      readonly runs: readonly {
        readonly results: readonly Record<string, unknown>[];
      }[];
    };
    expect(unchangedSarif.runs[0]?.results).toHaveLength(1);
    expect(unchangedSarif.runs[0]?.results[0]).not.toHaveProperty(
      "baselineState",
    );

    await writeFile(deckPath, missingMediaPptx({ extraMissingMedia: true }));
    const addedIo = createIo();
    await expect(
      runCli(["legacy.pptx", "--baseline", baselineFile], addedIo, {
        cwd: directory,
      }),
    ).resolves.toBe(1);
    expect(addedIo.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 new problem"),
    );
    expect(addedIo.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 existing"),
    );

    await writeFile(deckPath, buildMinimalPptx());
    const removedIo = createIo();
    await expect(
      runCli(["legacy.pptx", "--baseline", baselineFile], removedIo, {
        cwd: directory,
      }),
    ).resolves.toBe(0);
    expect(removedIo.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 resolved"),
    );
  });

  it("applies config suppressions and prints reasons", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "legacy.pptx"), missingMediaPptx());
    await writeFile(
      join(directory, ".pptxlintrc.json"),
      JSON.stringify({
        extends: ["recommended"],
        ignore: [
          {
            rule: "package/missing-media",
            slide: 1,
            reason: "Asset is injected downstream",
          },
        ],
      }),
    );
    const io = createIo();

    await expect(runCli(["legacy.pptx"], io, { cwd: directory })).resolves.toBe(
      0,
    );
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 suppressed"),
    );
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("Asset is injected downstream"),
    );
    expect(io.stdout.write).not.toHaveBeenCalledWith(
      expect.stringContaining("package/missing-media"),
    );
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("matches raw file suppressions to encoded POSIX input keys", async () => {
    if (pathSeparator !== "/") return;
    const directory = await temporaryDirectory();
    const deckDirectory = "a%b:c\\d";
    await mkdir(join(directory, deckDirectory));
    await writeFile(
      join(directory, deckDirectory, "legacy.pptx"),
      missingMediaPptx(),
    );
    await writeFile(
      join(directory, ".pptxlintrc.json"),
      JSON.stringify({
        extends: ["recommended"],
        ignore: [
          {
            rule: "package/missing-media",
            file: `${deckDirectory}/legacy.pptx`,
            reason: "Special-character path",
          },
        ],
      }),
    );
    const io = createIo();

    await expect(
      runCli([`${deckDirectory}/legacy.pptx`], io, { cwd: directory }),
    ).resolves.toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 suppressed"),
    );
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("Special-character path"),
    );
    expect(io.stdout.write).not.toHaveBeenCalledWith(
      expect.stringContaining("package/missing-media"),
    );
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("matches an external raw file suppression to its portable input key", async () => {
    const directory = await temporaryDirectory();
    const workingDirectory = join(directory, "work");
    const deckDirectory = join(directory, "first");
    await Promise.all([mkdir(workingDirectory), mkdir(deckDirectory)]);
    await writeFile(join(deckDirectory, "deck.pptx"), missingMediaPptx());
    await writeFile(
      join(workingDirectory, ".pptxlintrc.json"),
      JSON.stringify({
        extends: ["recommended"],
        ignore: [
          {
            rule: "package/missing-media",
            file: "../first/deck.pptx",
            reason: "External generated deck",
          },
        ],
      }),
    );
    const io = createIo();

    await expect(
      runCli(["../first/deck.pptx"], io, { cwd: workingDirectory }),
    ).resolves.toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("1 suppressed"),
    );
    expect(io.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("External generated deck"),
    );
    expect(io.stdout.write).not.toHaveBeenCalledWith(
      expect.stringContaining("package/missing-media"),
    );
    expect(io.stderr.write).not.toHaveBeenCalled();
  });

  it("rejects incompatible baselines before reading an input", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "legacy.json"),
      JSON.stringify({ schemaVersion: 2, toolMajorVersion: 0, inputs: [] }),
    );
    const io = createIo();

    await expect(
      runCli(["missing.pptx", "--baseline", "legacy.json"], io, {
        cwd: directory,
      }),
    ).resolves.toBe(2);
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("schemaVersion"),
    );
    expect(io.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining("Cannot read input"),
    );
  });

  it("rejects simultaneous baseline read and write modes", async () => {
    const io = createIo();

    await expect(
      runCli(
        [
          "legacy.pptx",
          "--baseline",
          "old.json",
          "--write-baseline",
          "new.json",
        ],
        io,
      ),
    ).resolves.toBe(2);
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("cannot be used together"),
    );
  });

  it("does not overwrite an input with baseline JSON", async () => {
    const io = createIo();

    await expect(
      runCli(["legacy.pptx", "--write-baseline", "./legacy.pptx"], io),
    ).resolves.toBe(2);
    expect(io.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("must not overwrite input"),
    );
  });

  it.each(["hardlink", "symlink"] as const)(
    "does not overwrite an input through a %s alias",
    async (aliasKind) => {
      const directory = await temporaryDirectory();
      const deckPath = join(directory, "deck.pptx");
      const baselinePath = join(directory, "baseline.json");
      const original = Buffer.from(missingMediaPptx());
      await writeFile(deckPath, original);
      if (aliasKind === "hardlink") {
        await link(deckPath, baselinePath);
      } else {
        await symlink("deck.pptx", baselinePath);
      }
      const io = createIo();

      await expect(
        runCli(["deck.pptx", "--write-baseline", "baseline.json"], io, {
          cwd: directory,
        }),
      ).resolves.toBe(2);
      expect(await readFile(deckPath)).toEqual(original);
      expect(io.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("must not overwrite input"),
      );
    },
  );

  it("atomically replaces a non-input symlink instead of following it", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "unrelated.json");
    await writeFile(join(directory, "deck.pptx"), missingMediaPptx());
    await writeFile(targetPath, "do not replace\n");
    await symlink("unrelated.json", join(directory, "baseline.json"));
    const io = createIo();

    await expect(
      runCli(["deck.pptx", "--write-baseline", "baseline.json"], io, {
        cwd: directory,
      }),
    ).resolves.toBe(1);
    expect(await readFile(targetPath, "utf8")).toBe("do not replace\n");
    expect(
      JSON.parse(await readFile(join(directory, "baseline.json"), "utf8")),
    ).toMatchObject({ schemaVersion: 3, toolMajorVersion: 0 });
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("writes a baseline whose valid basename is close to NAME_MAX", async () => {
    const directory = await temporaryDirectory();
    const baselineFile = `${"b".repeat(220)}.json`;
    expect(baselineFile).toHaveLength(225);
    await writeFile(join(directory, "deck.pptx"), missingMediaPptx());
    const io = createIo();

    await expect(
      runCli(["deck.pptx", "--write-baseline", baselineFile], io, {
        cwd: directory,
      }),
    ).resolves.toBe(1);
    expect(
      JSON.parse(await readFile(join(directory, baselineFile), "utf8")),
    ).toMatchObject({ schemaVersion: 3, toolMajorVersion: 0 });
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("uses stable distinct keys for external files across checkout paths", async () => {
    const inputKeysByCheckout: string[][] = [];
    const baselineByCheckout: string[] = [];
    const workingDirectories: string[] = [];
    for (let checkout = 0; checkout < 2; checkout += 1) {
      const directory = await temporaryDirectory();
      const workingDirectory = join(directory, "work");
      const firstDirectory = join(directory, "first");
      const secondDirectory = join(directory, "second");
      await Promise.all([
        mkdir(workingDirectory),
        mkdir(firstDirectory),
        mkdir(secondDirectory),
      ]);
      await writeFile(join(firstDirectory, "deck.pptx"), missingMediaPptx());
      await writeFile(
        join(secondDirectory, "deck.pptx"),
        missingMediaPptx({ extraMissingMedia: true }),
      );
      const io = createIo();

      await expect(
        runCli(
          [
            "../first/deck.pptx",
            "../second/deck.pptx",
            "--write-baseline",
            "baseline.json",
          ],
          io,
          { cwd: workingDirectory },
        ),
      ).resolves.toBe(1);
      const baselineText = await readFile(
        join(workingDirectory, "baseline.json"),
        "utf8",
      );
      const baseline = JSON.parse(baselineText) as {
        readonly inputs: readonly { readonly inputKey: string }[];
      };
      const inputKeys = baseline.inputs.map(({ inputKey }) => inputKey);
      expect(inputKeys).toHaveLength(2);
      expect(new Set(inputKeys).size).toBe(2);
      expect(
        inputKeys.every((inputKey) =>
          /^external\/[a-f0-9]{64}\/deck\.pptx$/u.test(inputKey),
        ),
      ).toBe(true);
      expect(baselineText).not.toContain(directory);
      inputKeysByCheckout.push(inputKeys);
      baselineByCheckout.push(baselineText);
      workingDirectories.push(workingDirectory);
    }

    expect(inputKeysByCheckout[1]).toEqual(inputKeysByCheckout[0]);
    const firstBaseline = baselineByCheckout[0];
    const secondWorkingDirectory = workingDirectories[1];
    if (firstBaseline === undefined || secondWorkingDirectory === undefined) {
      throw new TypeError("Expected two external checkout fixtures.");
    }
    await writeFile(
      join(secondWorkingDirectory, "baseline-from-first.json"),
      firstBaseline,
    );
    const compareIo = createIo();
    await expect(
      runCli(
        [
          "../first/deck.pptx",
          "../second/deck.pptx",
          "--baseline",
          "baseline-from-first.json",
        ],
        compareIo,
        { cwd: secondWorkingDirectory },
      ),
    ).resolves.toBe(0);
  });

  it("keeps literal POSIX backslashes distinct from path separators", async () => {
    if (pathSeparator !== "/") return;
    const directory = await temporaryDirectory();
    const workingDirectory = join(directory, "work");
    const literalBackslashDirectory = join(directory, "a\\b");
    const nestedDirectory = join(directory, "a", "b");
    await Promise.all([
      mkdir(workingDirectory),
      mkdir(literalBackslashDirectory),
      mkdir(nestedDirectory, { recursive: true }),
    ]);
    await writeFile(
      join(literalBackslashDirectory, "deck.pptx"),
      missingMediaPptx(),
    );
    await writeFile(
      join(nestedDirectory, "deck.pptx"),
      missingMediaPptx({ extraMissingMedia: true }),
    );

    const externalIo = createIo();
    await expect(
      runCli(
        [
          "../a\\b/deck.pptx",
          "../a/b/deck.pptx",
          "--write-baseline",
          "baseline.json",
        ],
        externalIo,
        { cwd: workingDirectory },
      ),
    ).resolves.toBe(1);
    const externalBaseline = JSON.parse(
      await readFile(join(workingDirectory, "baseline.json"), "utf8"),
    ) as { readonly inputs: readonly { readonly inputKey: string }[] };
    expect(
      new Set(externalBaseline.inputs.map(({ inputKey }) => inputKey)).size,
    ).toBe(2);

    const internalIo = createIo();
    await expect(
      runCli(
        [
          "a\\b/deck.pptx",
          "a/b/deck.pptx",
          "--write-baseline",
          "internal-baseline.json",
        ],
        internalIo,
        { cwd: directory },
      ),
    ).resolves.toBe(1);
    const internalBaseline = JSON.parse(
      await readFile(join(directory, "internal-baseline.json"), "utf8"),
    ) as { readonly inputs: readonly { readonly inputKey: string }[] };
    expect(
      internalBaseline.inputs.map(({ inputKey }) => inputKey).sort(),
    ).toEqual(["a%5Cb/deck.pptx", "a/b/deck.pptx"].sort());
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pptxlint-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function missingMediaPptx(
  options: {
    readonly duplicateXmlContentType?: boolean;
    readonly extraMissingMedia?: boolean;
  } = {},
): Uint8Array {
  const relationships = `<?xml version="1.0"?>
    <Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
      <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId8" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/missing.png"/>
      ${options.extraMissingMedia === true ? `<Relationship Id="rId9" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/also-missing.png"/>` : ""}
    </Relationships>`;
  return buildRawZip(
    minimalPptxEntries(minimalSlideXml()).map((entry) => {
      if (entry.name === "ppt/slides/_rels/slide1.xml.rels") {
        return { ...entry, data: relationships };
      }
      if (
        entry.name === "[Content_Types].xml" &&
        options.duplicateXmlContentType === true
      ) {
        if (typeof entry.data !== "string") {
          throw new TypeError("Expected textual content types fixture.");
        }
        return {
          ...entry,
          data: entry.data.replace(
            "</Types>",
            '<Default Extension="xml" ContentType="application/xml"/></Types>',
          ),
        };
      }
      return entry;
    }),
  );
}
