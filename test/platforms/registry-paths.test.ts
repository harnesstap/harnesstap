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

  it("detects kiro from .kiro/steering", () => {
    expect(detectPlatforms(ponytailFixture)).toContain("kiro");
  });

  it("detects antigravity from .agents/rules", () => {
    const projectDir = createTempDir("antigravity-rules");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Antigravity");
      writeTextFile(
        join(projectDir, ".agents/rules/style.md"),
        "---\ndescription: Style\n---\nUse clear names.\n",
      );

      expect(detectPlatforms(projectDir)).toContain("antigravity");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("detects amazon-q from .amazonq/rules", () => {
    const projectDir = createTempDir("amazon-q-rules");

    try {
      writeTextFile(
        join(projectDir, ".amazonq/rules/python.md"),
        "---\ndescription: Python\n---\nUse type hints.\n",
      );

      expect(detectPlatforms(projectDir)).toContain("amazon-q");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("detects grok-build from .grok/skills", () => {
    const projectDir = createTempDir("grok-build-skills");

    try {
      writeTextFile(
        join(projectDir, ".grok/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nReview carefully.\n",
      );

      expect(detectPlatforms(projectDir)).toContain("grok-build");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("detects deepseek-harness from .dsh/skills", () => {
    const projectDir = createTempDir("deepseek-harness-skills");

    try {
      writeTextFile(
        join(projectDir, ".dsh/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nReview carefully.\n",
      );

      expect(detectPlatforms(projectDir)).toContain("deepseek-harness");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("does not detect deepseek-harness from AGENTS.md or .agents/skills alone", () => {
    const projectDir = createTempDir("deepseek-harness-shared-only");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Shared\n");
      writeTextFile(
        join(projectDir, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review\n---\nBody.\n",
      );

      expect(detectPlatforms(projectDir)).not.toContain("deepseek-harness");
    } finally {
      cleanupDir(projectDir);
    }
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

  it("scans kiro rules from .kiro/steering", async () => {
    const serializer = new GenericAgentsSerializer("kiro");
    const resources = await serializer.scan(ponytailFixture);

    expect(resources.find((r) => r.type === "rule" && r.name === "ponytail")).toEqual(
      expect.objectContaining({
        source: ".kiro/steering/ponytail.md",
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
