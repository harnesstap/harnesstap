import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("project scan status", () => {
  it("reports no harness files for empty projects", async () => {
    const context = await createInitializedTestContext("project-scan-empty");

    try {
      const { assessProjectScanStatus } = await import(
        "../../src/services/project-scan-status.ts"
      );
      const status = await assessProjectScanStatus(context.projectDir);

      expect(status.comparison.status).toBe("no_harness_files");
      expect(status.on_disk.resources).toHaveLength(0);
      expect(status.in_library.resources).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("reports not scanned when disk has resources but library is empty", async () => {
    const context = await createInitializedTestContext("project-scan-not-scanned");

    try {
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");

      const { assessProjectScanStatus } = await import(
        "../../src/services/project-scan-status.ts"
      );
      const status = await assessProjectScanStatus(context.projectDir);

      expect(status.comparison.status).toBe("not_scanned");
      expect(status.on_disk.harness_resource_count).toBeGreaterThan(0);
      expect(status.in_library.resources).toHaveLength(0);
      expect(status.comparison.new_count).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("reports up to date when library matches disk", async () => {
    const context = await createInitializedTestContext("project-scan-up-to-date");

    try {
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      const { persistMergedProjectScan } = await import("../../src/services/scanner.ts");
      await persistMergedProjectScan(context.projectDir, undefined, {
        originRef: context.projectDir,
      });

      const { assessProjectScanStatus } = await import(
        "../../src/services/project-scan-status.ts"
      );
      const status = await assessProjectScanStatus(context.projectDir);

      expect(status.comparison.status).toBe("up_to_date");
      expect(status.in_library.resources.length).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("reports stale when disk content changes after scan", async () => {
    const context = await createInitializedTestContext("project-scan-stale");

    try {
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions v1");
      const { persistMergedProjectScan } = await import("../../src/services/scanner.ts");
      await persistMergedProjectScan(context.projectDir, undefined, {
        originRef: context.projectDir,
      });
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions v2");

      const { assessProjectScanStatus } = await import(
        "../../src/services/project-scan-status.ts"
      );
      const status = await assessProjectScanStatus(context.projectDir);

      expect(status.comparison.status).toBe("stale");
      expect(status.comparison.changed_count).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("tolerates malformed plugin manifests without failing status scan", async () => {
    const context = await createInitializedTestContext("project-scan-broken-plugin");

    try {
      mkdirSync(join(context.projectDir, ".cursor-plugin"), { recursive: true });
      mkdirSync(join(context.projectDir, "skills", "team"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".cursor-plugin", "plugin.json"),
        "{ invalid json",
      );
      writeFileSync(
        join(context.projectDir, "skills", "team", "SKILL.md"),
        "---\nname: team\ndescription: Team skill\n---\n# Team",
      );

      const { assessProjectScanStatus } = await import(
        "../../src/services/project-scan-status.ts"
      );
      const status = await assessProjectScanStatus(context.projectDir);

      expect(status.comparison.status).toBe("no_harness_files");
      expect(status.on_disk.plugin_source).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});

describe("project status payload", () => {
  it("builds structured status payload with profile and scan sections", async () => {
    const context = await createInitializedTestContext("project-status-payload");

    try {
      const harnessdeckDir = join(context.homeDir, ".harnessdeck");
      mkdirSync(harnessdeckDir, { recursive: true });
      writeFileSync(
        join(harnessdeckDir, "active-profile.json"),
        `${JSON.stringify({ name: "default" }, null, 2)}\n`,
      );

      const layerModel = await import("../../src/models/layer-model.ts");
      const profileLayer = layerModel.createLayer({
        name: "default",
        tags: ["profile"],
      });
      const resourceModel = await import("../../src/models/resource.ts");
      const instruction = resourceModel.createResource({
        type: "instruction",
        name: "profile-instructions",
        description: "",
        content: "# Profile",
        metadata: {},
        source: "test",
      });
      layerModel.addResourceToLayer(profileLayer.id, instruction.id);

      const { buildProjectStatusPayload } = await import(
        "../../src/services/project-status-payload.ts"
      );
      const payload = await buildProjectStatusPayload(context.projectDir);

      expect(payload.profile.active_profile).toBe("default@1.0.0");
      expect(payload.profile.stack_resource_count).toBeGreaterThan(0);
      expect(payload.project_resources.comparison.status).toBe("no_harness_files");
      expect(payload.resolved.resource_count).toBe(0);
    } finally {
      await context.cleanup();
    }
  });
});
