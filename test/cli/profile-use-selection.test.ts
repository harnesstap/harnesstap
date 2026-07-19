import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createLayer, setLayerTags, addResourceToLayer } from "../../src/models/layer-model.ts";
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
    content: `# ${name}`,
    metadata: {},
    source: "manual",
  });
  addResourceToLayer(layer.id, resource.id);
  return layer;
}

describe("profile use selection", () => {
  it("applies a project-configured profile via --profile", async () => {
    const context = await createTestContext("cli-profile-use-project");

    try {
      await runCli(["init", "--no-default-profile"]);
      createProfileLayer("repo-dev");
      createProfileLayer("work");

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "dev"

[[profiles]]
name = "dev"
source = "local"
selector = "repo-dev"
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
      expect(result.stdout).toContain("dev");
      expect(result.stdout).toContain("repo-dev");
    } finally {
      await context.cleanup();
    }
  });

  it("applies a global profile layer by name even when project config exists", async () => {
    const context = await createTestContext("cli-profile-use-global");

    try {
      await runCli(["init", "--no-default-profile"]);
      createProfileLayer("work");
      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnesstap:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "work"
`,
      );

      const result = await runCli([
        "profile",
        "use",
        "work",
        "--harness",
        "claude-code",
        "--on-conflict",
        "replace",
        "--no-interactive",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("work");
    } finally {
      await context.cleanup();
    }
  });
});
