import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createProject } from "../../src/models/project.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import {
  executeResourceDiskDeletion,
  planResourceDiskDeletion,
} from "../../src/services/resource-disk-cleanup.ts";

describe("resource disk cleanup", () => {
  it("deduplicates global and project ownership rows into distinct locations", async () => {
    const context = await createInitializedTestContext("disk-cleanup-dedupe");
    try {
      const resource = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: "manual",
      });
      const projectA = createProject({
        git_origin: "https://example.com/a.git",
        name: "proj-a",
        local_path: join(context.rootDir, "proj-a"),
      });
      const projectB = createProject({
        git_origin: "https://example.com/b.git",
        name: "proj-b",
        local_path: join(context.rootDir, "proj-b"),
      });
      mkdirSync(projectA.local_path, { recursive: true });
      mkdirSync(projectB.local_path, { recursive: true });

      const globalPath = join(context.homeDir, ".cursor", "skills", "ship", "SKILL.md");
      const projectAPath = join(projectA.local_path, ".cursor", "skills", "ship", "SKILL.md");
      const projectBPath = join(projectB.local_path, ".cursor", "skills", "ship", "SKILL.md");
      for (const path of [globalPath, projectAPath, projectBPath]) {
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "# Ship\n", "utf-8");
      }
      const hash = hashGeneratedContent("# Ship\n");

      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: hash,
        managed_container: true,
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "project",
        project_id: projectA.id,
        root_path: projectA.local_path,
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: hash,
        managed_container: true,
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "project",
        project_id: projectB.id,
        root_path: projectB.local_path,
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: hash,
        managed_container: true,
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.locations).toHaveLength(3);
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.locations.map((l) => l.scope).sort()).toEqual([
        "global",
        "project",
        "project",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("includes a source path once even when it matches a generated path", async () => {
    const context = await createInitializedTestContext("disk-cleanup-source-dedupe");
    try {
      const skillPath = join(context.homeDir, ".cursor", "skills", "ship", "SKILL.md");
      mkdirSync(join(skillPath, ".."), { recursive: true });
      writeFileSync(skillPath, "# Ship\n", "utf-8");
      const hash = hashGeneratedContent("# Ship\n");

      const resource = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: skillPath,
        origin_ref: skillPath,
      });

      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: hash,
        managed_container: true,
      });

      const plan = await planResourceDiskDeletion(resource.id);
      const matching = plan.locations.filter(
        (location) =>
          location.path === skillPath ||
          location.path === join(skillPath, ".."),
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]?.scope).toBe("global");
    } finally {
      await context.cleanup();
    }
  });

  it("deletes an unchanged standalone file", async () => {
    const context = await createInitializedTestContext("disk-cleanup-standalone");
    try {
      const filePath = join(context.homeDir, ".cursor", "rules", "ship.mdc");
      mkdirSync(join(filePath, ".."), { recursive: true });
      const content = "---\ndescription: ship\nalwaysApply: true\n---\n# Ship\n";
      writeFileSync(filePath, content, "utf-8");
      const hash = hashGeneratedContent(content);

      const resource = createResource({
        type: "rule",
        name: "ship",
        description: "ship",
        content: "# Ship",
        metadata: { globs: [], always_apply: true },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/rules/ship.mdc",
        action: "delete-file",
        ownership_key: "rule:ship",
        generated_hash: hash,
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.locations[0]?.action).toBe("delete-file");

      const result = await executeResourceDiskDeletion(plan);
      expect(result.deleted_files).toEqual([filePath]);
      expect(existsSync(filePath)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("protects a modified standalone file and blocks the plan", async () => {
    const context = await createInitializedTestContext("disk-cleanup-modified");
    try {
      const filePath = join(context.homeDir, ".cursor", "rules", "ship.mdc");
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, "modified locally\n", "utf-8");

      const resource = createResource({
        type: "rule",
        name: "ship",
        description: "ship",
        content: "# Ship",
        metadata: { globs: [], always_apply: true },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/rules/ship.mdc",
        action: "delete-file",
        ownership_key: "rule:ship",
        generated_hash: hashGeneratedContent("original\n"),
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(false);
      expect(plan.blockers).toContain("Modified file is protected");
      expect(plan.locations[0]?.action).toBe("protected");
    } finally {
      await context.cleanup();
    }
  });

  it("surgically removes one MCP server from an aggregate file", async () => {
    const context = await createInitializedTestContext("disk-cleanup-mcp-edit");
    try {
      const filePath = join(context.homeDir, ".cursor", "mcp.json");
      mkdirSync(join(filePath, ".."), { recursive: true });
      const original = {
        mcpServers: {
          search: { command: "search-mcp" },
          keep: { command: "keep-mcp" },
        },
      };
      writeFileSync(filePath, `${JSON.stringify(original, null, 2)}\n`, "utf-8");

      const resource = createResource({
        type: "mcp_server",
        name: "search",
        description: "",
        content: "",
        metadata: { transport: "stdio", command: "search-mcp" },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/mcp.json",
        action: "edit-file",
        ownership_key: "mcp_server:search",
        generated_hash: hashGeneratedContent(`${JSON.stringify(original, null, 2)}\n`),
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.locations[0]?.action).toBe("edit-file");

      const result = await executeResourceDiskDeletion(plan);
      expect(result.edited_files).toEqual([filePath]);
      const updated = JSON.parse(readFileSync(filePath, "utf-8")) as {
        mcpServers: Record<string, unknown>;
      };
      expect(updated.mcpServers.search).toBeUndefined();
      expect(updated.mcpServers.keep).toEqual({ command: "keep-mcp" });
    } finally {
      await context.cleanup();
    }
  });

  it("protects a shared source path when the section cannot be identified", async () => {
    const context = await createInitializedTestContext("disk-cleanup-shared-source");
    try {
      const filePath = join(context.homeDir, "notes", "bundle.md");
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, "# mixed content without markers\n", "utf-8");

      const resource = createResource({
        type: "instruction",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: filePath,
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(false);
      expect(plan.blockers).toContain("Shared file section cannot be identified");
      expect(plan.locations.some((location) => location.action === "protected")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects paths outside the declared root", async () => {
    const context = await createInitializedTestContext("disk-cleanup-escape");
    try {
      const outside = join(context.rootDir, "outside", "escape.md");
      mkdirSync(join(outside, ".."), { recursive: true });
      writeFileSync(outside, "escape\n", "utf-8");

      const resource = createResource({
        type: "rule",
        name: "escape",
        description: "",
        content: "escape",
        metadata: { globs: [], always_apply: true },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: outside,
        action: "delete-file",
        ownership_key: "rule:escape",
        generated_hash: hashGeneratedContent("escape\n"),
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(false);
      expect(plan.blockers).toContain("Path escapes declared root");
      expect(plan.locations[0]?.action).toBe("protected");
    } finally {
      await context.cleanup();
    }
  });
});
