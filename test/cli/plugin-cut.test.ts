import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { upsertResource } from "../../src/models/resource.ts";
import { getPlugin, getPluginByName } from "../../src/models/plugin-model.ts";

describe("CLI plugin cut", () => {
  it("cuts a new version from the working head", async () => {
    const context = await createTestContext("cli-plugin-cut-success");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);

      const result = await runCli(["plugin", "cut", "alpha", "--version", "1.1.0"]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("alpha@1.1.0");

      const head = getPlugin("alpha");
      expect(head?.version).toBe("1.1.0");
      expect(head?.dirty).toBe(false);

      const frozen = getPluginByName("alpha", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin cut --format json prints the cut plugin", async () => {
    const context = await createTestContext("cli-plugin-cut-json");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);

      const result = await runCli([
        "plugin",
        "cut",
        "alpha",
        "--version",
        "2.0.0",
        "--format",
        "json",
      ]);

      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.name).toBe("alpha");
      expect(payload.version).toBe("2.0.0");
      expect(payload.dirty).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when new version equals current", async () => {
    const context = await createTestContext("cli-plugin-cut-same-version");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);

      const result = await runCli(["plugin", "cut", "alpha", "--version", "1.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("must differ from current version 1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when target version already exists", async () => {
    const context = await createTestContext("cli-plugin-cut-version-exists");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      await runCli(["plugin", "create", "alpha", "--version", "2.0.0"]);

      const result = await runCli(["plugin", "cut", "alpha@1.0.0", "--version", "2.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("alpha@2.0.0 already exists");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut on a frozen plugin version", async () => {
    const context = await createTestContext("cli-plugin-cut-frozen");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      await runCli(["plugin", "cut", "alpha", "--version", "1.1.0"]);

      const result = await runCli(["plugin", "cut", "alpha@1.0.0", "--version", "2.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("frozen");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list shows dirty version with a star in human output", async () => {
    const context = await createTestContext("cli-plugin-list-dirty-human");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "plugin",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const listResult = await runCli(["plugin", "list", "--local-only"]);
      expect(listResult.stdout).toMatch(/alpha\s+\|\s+authored\s+\|\s+1\.0\.0\*/);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list --format json includes dirty on local plugins", async () => {
    const context = await createTestContext("cli-plugin-list-dirty-json");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "plugin",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const listResult = await runCli(["plugin", "list", "--local-only", "--format", "json"]);
      const payload = JSON.parse(listResult.stdout);
      const alpha = payload.find((plugin: { name: string }) => plugin.name === "alpha");
      expect(alpha?.dirty).toBe(true);
      expect(alpha?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show human output marks dirty versions with a star", async () => {
    const context = await createTestContext("cli-plugin-show-dirty-human");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "plugin",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const showResult = await runCli(["plugin", "show", "alpha"]);
      expect(showResult.stdout).toContain("alpha@1.0.0*");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show --format json includes dirty", async () => {
    const context = await createTestContext("cli-plugin-show-dirty-json");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "plugin",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const showResult = await runCli(["plugin", "show", "alpha", "--format", "json"]);
      const payload = JSON.parse(showResult.stdout);
      expect(payload.dirty).toBe(true);
      expect(payload.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });
});
