import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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

  it("lets a modified standalone file be deleted after confirmation", async () => {
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
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.blockers).toEqual([]);
      expect(plan.confirmations).toContain("Modified file is protected");
      expect(plan.locations[0]?.action).toBe("delete-file");
      expect(plan.locations[0]?.reason).toBe("Modified file is protected");

      const result = await executeResourceDiskDeletion(plan);
      expect(result.deleted_files).toEqual([filePath]);
      expect(existsSync(filePath)).toBe(false);
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

  it("lets a modified skill directory be deleted after confirmation", async () => {
    const context = await createInitializedTestContext("disk-cleanup-modified-skill");
    try {
      const skillPath = join(context.homeDir, ".cursor", "skills", "ship", "SKILL.md");
      mkdirSync(join(skillPath, ".."), { recursive: true });
      writeFileSync(skillPath, "# changed on disk\n", "utf-8");

      const resource = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: hashGeneratedContent("# Ship\n"),
        managed_container: true,
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.confirmations).toContain("Modified file is protected");
      expect(plan.locations[0]?.action).toBe("delete-directory");

      const result = await executeResourceDiskDeletion(plan);
      expect(result.deleted_files).toEqual([dirname(skillPath)]);
      expect(existsSync(skillPath)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("resolves tilde-prefixed sources to home files", async () => {
    const context = await createInitializedTestContext("disk-cleanup-tilde-source");
    try {
      const skillPath = join(
        context.homeDir,
        ".claude",
        "skills",
        "ship",
        "SKILL.md",
      );
      mkdirSync(join(skillPath, ".."), { recursive: true });
      writeFileSync(skillPath, "# Ship\n", "utf-8");

      const resource = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: "~/.claude/skills/ship/SKILL.md",
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.locations.some((location) => location.path === dirname(skillPath))).toBe(
        true,
      );

      const result = await executeResourceDiskDeletion(plan);
      expect(result.deleted_files).toContain(dirname(skillPath));
      expect(existsSync(skillPath)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("deletes a host plugin install tree and unregisters it", async () => {
    const context = await createInitializedTestContext("disk-cleanup-plugin-pin");
    try {
      const sha = "d183d812c10a49c75de5dd647f7f2e448c8de366";
      const installRoot = join(
        context.homeDir,
        ".claude",
        "plugins",
        "cache",
        "__DEFAULT__",
        "caveman",
        sha,
      );
      mkdirSync(join(installRoot, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(installRoot, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "caveman", version: "1.0.0" }),
      );
      writeFileSync(join(installRoot, "README.md"), "# caveman\n");

      const registryPath = join(
        context.homeDir,
        ".claude",
        "plugins",
        "installed_plugins.json",
      );
      writeFileSync(
        registryPath,
        `${JSON.stringify(
          {
            version: 2,
            plugins: {
              "keep@__DEFAULT__": [
                { scope: "user", installPath: "cache/__DEFAULT__/keep/1.0.0", version: "1.0.0" },
              ],
              "caveman@__DEFAULT__": [
                {
                  scope: "user",
                  installPath: `cache/__DEFAULT__/caveman/${sha}`,
                  version: sha,
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const settingsPath = join(context.homeDir, ".claude", "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify(
          {
            enabledPlugins: {
              "keep@__DEFAULT__": true,
              "caveman@__DEFAULT__": true,
            },
          },
          null,
          2,
        )}\n`,
      );

      const resource = createResource({
        type: "plugin",
        name: "caveman",
        namespace: "__DEFAULT__",
        description: "Plugin pin: caveman@__DEFAULT__",
        content: "{}",
        metadata: {
          source_kind: "marketplace",
          marketplace_name: "__DEFAULT__",
          resolved_version: sha,
          sync_status: "never_synced",
          portable: "reference",
        },
        source: "~/.claude/plugins/installed_plugins.json",
        origin_kind: "marketplace_link",
        origin_ref: "caveman@__DEFAULT__",
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.can_delete_from_disk).toBe(true);
      expect(plan.locations.map((location) => location.action).sort()).toEqual([
        "delete-directory",
        "edit-file",
        "edit-file",
      ]);
      expect(plan.locations.some((location) => location.path === installRoot)).toBe(true);

      const result = await executeResourceDiskDeletion(plan);
      expect(result.deleted_files).toContain(installRoot);
      expect(result.edited_files).toEqual(
        expect.arrayContaining([registryPath, settingsPath]),
      );
      expect(existsSync(installRoot)).toBe(false);

      const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as {
        plugins: Record<string, unknown>;
      };
      expect(registry.plugins["caveman@__DEFAULT__"]).toBeUndefined();
      expect(registry.plugins["keep@__DEFAULT__"]).toBeDefined();

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        enabledPlugins: Record<string, boolean>;
      };
      expect(settings.enabledPlugins["caveman@__DEFAULT__"]).toBeUndefined();
      expect(settings.enabledPlugins["keep@__DEFAULT__"]).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("does not delete a host install when removing a composition plugin ref", async () => {
    const context = await createInitializedTestContext(
      "disk-cleanup-composition-plugin-ref",
    );
    try {
      const installRoot = join(
        context.homeDir,
        ".claude",
        "plugins",
        "cache",
        "demo-market",
        "demo",
        "1.0.0",
      );
      mkdirSync(join(installRoot, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(installRoot, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
      );

      const resource = createResource({
        type: "plugin",
        name: "demo",
        description: "Dependency: demo",
        content: "{}",
        metadata: {
          source_kind: "local",
          sync_status: "never_synced",
          portable: "reference",
        },
        source: "composition:plugin",
        origin_kind: "manual",
        origin_ref: "demo",
      });

      const plan = await planResourceDiskDeletion(resource.id);
      expect(plan.locations).toEqual([]);
      expect(existsSync(installRoot)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
