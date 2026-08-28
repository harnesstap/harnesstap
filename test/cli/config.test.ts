import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

const VALID_PROJECT_CONFIG = `name: demo
version: "1.0.0"
x-harnesstap:
  default_profile: dev
  default_environment: shared
  profiles:
    - name: dev
      source: local
      selector: team-stack
    - name: custom
      source: inline
      plugin: embedded-plugin
  environments:
    - name: shared
      values:
        REGION: us
  plugins:
    - name: embedded-plugin
      description: inline plugin for custom profile
`;

function writeProjectConfig(projectDir: string, yaml = VALID_PROJECT_CONFIG) {
  writeTextFile(join(projectDir, "apm.yml"), yaml);
}

describe("CLI config", () => {
  it("shows project config in human format", async () => {
    const context = await createTestContext("cli-config-show");

    try {
      writeProjectConfig(context.projectDir);
      const result = await runCli(["config", "show"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("apm.yml");
      expect(result.stdout).toContain("dev");
      expect(result.stdout).toContain("shared");
      expect(result.stdout).toContain("2 profile");
    } finally {
      await context.cleanup();
    }
  });

  it("shows project config as json", async () => {
    const context = await createTestContext("cli-config-show-json");

    try {
      writeProjectConfig(context.projectDir);
      const result = await runCli(["config", "show", "--format", "json"]);

      expect(result.exitCode).toBeUndefined();
      const payload = JSON.parse(result.stdout);
      expect(payload.default_profile).toBe("dev");
      expect(payload.name).toBe("demo");
      expect(payload.version).toBe("1.0.0");
      expect(payload.environment_count).toBe(1);
      expect(payload.plugin_count).toBe(1);
      expect(payload.plugins).toEqual([{ name: "embedded-plugin" }]);
    } finally {
      await context.cleanup();
    }
  });

  it("errors when no project config is present", async () => {
    const context = await createTestContext("cli-config-show-missing");

    try {
      const result = await runCli(["config", "show"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/apm\.yml|config/i);
    } finally {
      await context.cleanup();
    }
  });

  it("validates a healthy project config", async () => {
    const context = await createTestContext("cli-config-validate-ok");

    try {
      writeProjectConfig(context.projectDir);
      const result = await runCli(["config", "validate"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("valid");
    } finally {
      await context.cleanup();
    }
  });

  it("reports validation errors as json", async () => {
    const context = await createTestContext("cli-config-validate-json");

    try {
      writeProjectConfig(
        context.projectDir,
        `name: demo
version: "1.0.0"
x-harnesstap:
  profiles:
    - name: custom
      source: inline
      plugin: missing-plugin
`,
      );
      const result = await runCli(["config", "validate", "--format", "json"]);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.valid).toBe(false);
      expect(payload.errors).toEqual([
        "Profile custom with inline source references unknown plugin: missing-plugin",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("creates project config from local profile plugins", async () => {
    const context = await createTestContext("cli-config-init");

    try {
      await runCli(["init", "--no-default-profile"]);
      const work = createPlugin({ name: "work" });
      setPluginTags(work.id, ["profile"]);
      const personal = createPlugin({ name: "personal" });
      setPluginTags(personal.id, ["profile"]);

      const result = await runCli([
        "config",
        "init",
        "--no-interactive",
        "--profile",
        "work",
        "--profile",
        "personal",
        "--default",
        "work",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("Created project config");
      expect(result.stdout).toContain("work");
      expect(result.stdout).toContain("personal");
      expect(existsSync(join(context.projectDir, "apm.yml"))).toBe(true);

      const show = await runCli(["config", "show", "--format", "json"]);
      const payload = JSON.parse(show.stdout);
      expect(payload.default_profile).toBe("work");
      expect(payload.profiles).toHaveLength(2);
    } finally {
      await context.cleanup();
    }
  });

  it("seeds a default profile when config init runs with none", async () => {
    const context = await createTestContext("cli-config-init-empty");

    try {
      await runCli(["init", "--no-default-profile"]);
      const result = await runCli(["config", "init", "--no-interactive"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("Created project config");
      expect(result.stdout).toContain("global default");

      const show = await runCli(["config", "show", "--format", "json"]);
      const payload = JSON.parse(show.stdout);
      expect(payload.default_profile).toBe("global default");
      expect(payload.profiles).toEqual([
        expect.objectContaining({ name: "global default" }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("refuses to overwrite existing project config without --force", async () => {
    const context = await createTestContext("cli-config-init-existing");

    try {
      await runCli(["init"]);
      writeProjectConfig(context.projectDir);
      const result = await runCli(["config", "init", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/already exists/i);
    } finally {
      await context.cleanup();
    }
  });
});
