import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

const VALID_PROJECT_CONFIG = `schema = "urn:harnessdeck:project:v1"
version = 1
default_profile = "dev"
default_environment = "shared"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"

[[profiles]]
name = "custom"
source = "inline"
layer = "embedded-layer"

[[environments]]
name = "shared"

[environments.values]
REGION = "us"

[[layers]]
name = "embedded-layer"
description = "inline layer for custom profile"
`;

function writeProjectConfig(projectDir: string, toml = VALID_PROJECT_CONFIG) {
  mkdirSync(join(projectDir, ".harnessdeck"), { recursive: true });
  writeTextFile(join(projectDir, ".harnessdeck", "config.toml"), toml);
}

describe("CLI config", () => {
  it("shows project config in human format", async () => {
    const context = await createTestContext("cli-config-show");

    try {
      writeProjectConfig(context.projectDir);
      const result = await runCli(["config", "show"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("config.toml");
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
      expect(payload.environment_count).toBe(1);
      expect(payload.layer_count).toBe(1);
      expect(payload.layers).toEqual([{ name: "embedded-layer" }]);
    } finally {
      await context.cleanup();
    }
  });

  it("errors when no project config is present", async () => {
    const context = await createTestContext("cli-config-show-missing");

    try {
      const result = await runCli(["config", "show"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/config/i);
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
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "custom"
source = "inline"
layer = "missing-layer"
`,
      );
      const result = await runCli(["config", "validate", "--format", "json"]);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.valid).toBe(false);
      expect(payload.errors).toEqual([
        "Profile custom with inline source references unknown layer: missing-layer",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("stubs config init with a hint", async () => {
    const context = await createTestContext("cli-config-init");

    try {
      const result = await runCli(["config", "init"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/not available yet/i);
    } finally {
      await context.cleanup();
    }
  });
});
