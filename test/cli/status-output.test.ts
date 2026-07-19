import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI status output", () => {
  it("renders structured human output without environment cascade JSON", async () => {
    const context = await createTestContext("cli-status-human");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-status.git");
      await runCli(["init"]);

      const status = await runCli(["status", context.projectDir]);

      expect(status.stdout).toContain("PROJECT");
      expect(status.stdout).toContain("PROFILE");
      expect(status.stdout).toContain("APPLIED LAYERS");
      expect(status.stdout).toContain("RESOLVED");
      expect(status.stdout).toContain("PROJECT RESOURCES");
      expect(status.stdout).toContain("SCAN");
      expect(status.stdout).not.toContain("ENVIRONMENT CASCADE");
      expect(status.stdout).not.toContain("layer_defaults");
      expect(status.stdout).not.toContain("secretRefs");
    } finally {
      await context.cleanup();
    }
  });

  it("reports applied layers with resource summaries", async () => {
    const context = await createTestContext("cli-status-layers");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/status-layers.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "tracked" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "tracked-context",
          content: "# Tracked instructions",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      await runCli([
        "layer",
        "apply",
        "tracked",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      const status = await runCli(["status", context.projectDir]);

      expect(status.stdout).toContain("tracked@");
      expect(status.stdout).toContain("instruction");
      expect(status.stdout).toContain("RESOLVED");
    } finally {
      await context.cleanup();
    }
  });

  it("extends json output with structured sections while keeping environment_cascade", async () => {
    const context = await createTestContext("cli-status-json");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/status-json.git");
      await runCli(["init"]);

      const status = await runCli(["status", context.projectDir, "--format", "json"]);
      const payload = JSON.parse(status.stdout);

      expect(payload).toEqual(
        expect.objectContaining({
          project_root: context.projectDir,
          environment_cascade: expect.any(Object),
          profile: expect.objectContaining({
            active_profile: expect.anything(),
          }),
          project_resources: expect.objectContaining({
            comparison: expect.objectContaining({
              status: expect.any(String),
            }),
          }),
          resolved: expect.objectContaining({
            resource_count: expect.any(Number),
          }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });
});
