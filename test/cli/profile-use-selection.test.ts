import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createPlugin, setPluginTags, addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

function writeProjectConfig(projectDir: string, yaml: string) {
  writeTextFile(join(projectDir, "apm.yml"), yaml);
}

function createProfilePlugin(name: string) {
  const plugin = createPlugin({ name });
  setPluginTags(plugin.id, ["profile"]);
  const resource = createResource({
    type: "instruction",
    name: `${name}-guide`,
    description: "",
    content: `# ${name}`,
    metadata: {},
    source: "manual",
  });
  addResourceToPlugin(plugin.id, resource.id);
  return plugin;
}

describe("profile use selection", () => {
  it("applies a project-configured profile via --profile", async () => {
    const context = await createTestContext("cli-profile-use-project");

    try {
      await runCli(["init", "--no-default-profile"]);
      createProfilePlugin("repo-dev");
      createProfilePlugin("work");

      writeProjectConfig(
        context.projectDir,
        `name: demo
version: "1.0.0"
x-harnesstap:
  default_profile: dev
  profiles:
    - name: dev
      source: local
      selector: repo-dev
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

  it("applies a global profile plugin by name even when project config exists", async () => {
    const context = await createTestContext("cli-profile-use-global");

    try {
      await runCli(["init", "--no-default-profile"]);
      createProfilePlugin("work");
      writeProjectConfig(
        context.projectDir,
        `name: demo
version: "1.0.0"
x-harnesstap:
  profiles:
    - name: dev
      source: local
      selector: work
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
