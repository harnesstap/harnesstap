import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { detectPlatforms } from "../../src/services/scanner.ts";
import { OpenCodeSerializer } from "../../src/platforms/opencode.ts";
import { GenericAgentsSerializer } from "../../src/platforms/generic-agents.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const ponytailFixture = fileURLToPath(
  new URL("../fixtures/ponytail/full", import.meta.url),
);

describe("registry path detection", () => {
  it("detects windsurf from .windsurf/rules", () => {
    expect(detectPlatforms(ponytailFixture)).toContain("windsurf");
  });

  it("detects cline from .clinerules directory", () => {
    expect(detectPlatforms(ponytailFixture)).toContain("cline");
  });

  it("detects opencode from .opencode/command", () => {
    expect(detectPlatforms(ponytailFixture)).toContain("opencode");
  });

  it("detects cline from legacy .clinerules file", () => {
    const projectDir = createTempDir("cline-legacy-rules");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Cline");
      writeTextFile(join(projectDir, ".clinerules"), "## Legacy rule\n\nUse tests.");

      expect(detectPlatforms(projectDir)).toContain("cline");
    } finally {
      cleanupDir(projectDir);
    }
  });
});

describe("registry path scanning", () => {
  it("scans windsurf rules from .windsurf/rules", async () => {
    const serializer = new GenericAgentsSerializer("windsurf");
    const resources = await serializer.scan(ponytailFixture);

    expect(resources.find((r) => r.type === "rule" && r.name === "ponytail")).toEqual(
      expect.objectContaining({
        source: ".windsurf/rules/ponytail.md",
      }),
    );
  });

  it("scans cline rules from .clinerules directory", async () => {
    const serializer = new GenericAgentsSerializer("cline");
    const resources = await serializer.scan(ponytailFixture);

    expect(resources.find((r) => r.type === "rule" && r.name === "ponytail")).toEqual(
      expect.objectContaining({
        source: ".clinerules/ponytail.md",
      }),
    );
  });

  it("scans opencode commands from .opencode/command/", async () => {
    const serializer = new OpenCodeSerializer();
    const resources = await serializer.scan(ponytailFixture);

    expect(resources.find((r) => r.type === "command" && r.name === "ponytail")).toEqual(
      expect.objectContaining({
        source: ".opencode/command/ponytail.md",
      }),
    );
  });

  it("serializes opencode commands to singular path when sourced from .opencode/command/", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "command",
          name: "ponytail",
          content: "# Ponytail command",
          source: ".opencode/command/ponytail.md",
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toContain(".opencode/command/ponytail.md");
    expect(files.map((file) => file.path)).not.toContain(".opencode/commands/ponytail.md");
  });
});
