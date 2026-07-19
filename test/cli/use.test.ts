import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

function writeProjectConfig(projectDir: string, toml: string) {
  mkdirSync(join(projectDir, ".harnesstap"), { recursive: true });
  writeTextFile(join(projectDir, ".harnesstap", "config.toml"), toml);
}

function createProfileLayer(name: string) {
  const layer = createLayer({ name });
  setLayerTags(layer.id, ["profile"]);
  const resource = createResource({
    type: "instruction",
    name: `${name}-guide`,
    description: "",
    content: `# ${name} guide`,
    metadata: {},
    source: "manual",
  });
  addResourceToLayer(layer.id, resource.id);
  return layer;
}

describe("CLI use", () => {
  it("applies a local profile from project config", async () => {
    const context = await createTestContext("cli-use-apply");

    try {
      await runCli(["init"]);
      createProfileLayer("team-stack");
      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnesstap:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      );

      const result = await runCli([
        "use",
        "--no-interactive",
        "--profile",
        "dev",
        "--harness",
        "claude-code",
        "--on-conflict",
        "replace",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("Applied profile");
      expect(result.stdout).toContain("dev");
      expect(
        existsSync(join(context.homeDir, ".claude", "CLAUDE.md")) ||
          existsSync(join(context.homeDir, "CLAUDE.md")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("lists profiles from project config", async () => {
    const context = await createTestContext("cli-use-list");

    try {
      await runCli(["init"]);
      createProfileLayer("team-stack");
      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "dev"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
environment = "staging"
`,
      );

      const result = await runCli(["use", "--list"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("dev");
      expect(result.stdout).toContain("local");
      expect(result.stdout).toContain("team-stack");
      expect(result.stdout).toContain("staging");
    } finally {
      await context.cleanup();
    }
  });

  it("errors when no project config is present", async () => {
    const context = await createTestContext("cli-use-no-config");

    try {
      await runCli(["init"]);
      const result = await runCli(["use", "--no-interactive", "--profile", "dev"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/config/i);
    } finally {
      await context.cleanup();
    }
  });

  it("delegates profile use to project config when name is omitted", async () => {
    const context = await createTestContext("cli-profile-use-delegate");

    try {
      await runCli(["init"]);
      createProfileLayer("team-stack");
      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnesstap:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      );

      const result = await runCli([
        "profile",
        "use",
        "--no-interactive",
        "--profile",
        "dev",
        "--harness",
        "claude-code",
        "--on-conflict",
        "replace",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("Applied profile");
      expect(result.stdout).toContain("dev");
    } finally {
      await context.cleanup();
    }
  });
});
