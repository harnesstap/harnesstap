import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { upsertResource } from "../../src/models/resource.ts";
import { getLayer, getLayerByName } from "../../src/models/layer-model.ts";

describe("CLI layer cut", () => {
  it("cuts a new version from the working head", async () => {
    const context = await createTestContext("cli-layer-cut-success");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);

      const result = await runCli(["layer", "cut", "alpha", "--version", "1.1.0"]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("alpha@1.1.0");

      const head = getLayer("alpha");
      expect(head?.version).toBe("1.1.0");
      expect(head?.dirty).toBe(false);

      const frozen = getLayerByName("alpha", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("layer cut --format json prints the cut layer", async () => {
    const context = await createTestContext("cli-layer-cut-json");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);

      const result = await runCli([
        "layer",
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
    const context = await createTestContext("cli-layer-cut-same-version");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);

      const result = await runCli(["layer", "cut", "alpha", "--version", "1.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("must differ from current version 1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when target version already exists", async () => {
    const context = await createTestContext("cli-layer-cut-version-exists");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);
      await runCli(["layer", "create", "alpha", "--version", "2.0.0"]);

      const result = await runCli(["layer", "cut", "alpha@1.0.0", "--version", "2.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("alpha@2.0.0 already exists");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut on a frozen layer version", async () => {
    const context = await createTestContext("cli-layer-cut-frozen");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);
      await runCli(["layer", "cut", "alpha", "--version", "1.1.0"]);

      const result = await runCli(["layer", "cut", "alpha@1.0.0", "--version", "2.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("frozen");
    } finally {
      await context.cleanup();
    }
  });

  it("layer list shows dirty version with a star in human output", async () => {
    const context = await createTestContext("cli-layer-list-dirty-human");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "layer",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const listResult = await runCli(["layer", "list", "--local-only"]);
      expect(listResult.stdout).toMatch(/alpha\s+\|\s+1\.0\.0\*/);
    } finally {
      await context.cleanup();
    }
  });

  it("layer list --format json includes dirty on local layers", async () => {
    const context = await createTestContext("cli-layer-list-dirty-json");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "layer",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const listResult = await runCli(["layer", "list", "--local-only", "--format", "json"]);
      const payload = JSON.parse(listResult.stdout);
      const alpha = payload.find((layer: { name: string }) => layer.name === "alpha");
      expect(alpha?.dirty).toBe(true);
      expect(alpha?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("layer show human output marks dirty versions with a star", async () => {
    const context = await createTestContext("cli-layer-show-dirty-human");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "layer",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const showResult = await runCli(["layer", "show", "alpha"]);
      expect(showResult.stdout).toContain("alpha@1.0.0*");
    } finally {
      await context.cleanup();
    }
  });

  it("layer show --format json includes dirty", async () => {
    const context = await createTestContext("cli-layer-show-dirty-json");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "alpha", "--version", "1.0.0"]);
      upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      );
      await runCli([
        "layer",
        "edit",
        "alpha",
        "--add",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const showResult = await runCli(["layer", "show", "alpha", "--format", "json"]);
      const payload = JSON.parse(showResult.stdout);
      expect(payload.dirty).toBe(true);
      expect(payload.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });
});
