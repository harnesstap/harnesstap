import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createPlugin, addResourceToPlugin, setPluginTags, getPluginById } from "../../src/models/plugin-model.ts";
import { createResource, getResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import {
  commitManagedPathFromLive,
  commitManagedResourceFromLive,
  isAggregateConfigManagedPath,
  isMcpConfigManagedPath,
  resourceKeyFromManagedPath,
} from "../../src/services/profile-commit-resource.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { listResources } from "../../src/models/resource.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";

describe("profile-commit-resource", () => {
  it("maps skill paths to resource keys", () => {
    expect(
      resourceKeyFromManagedPath(".claude/skills/manual-skill/SKILL.md"),
    ).toEqual({ type: "skill", name: "manual-skill" });
    expect(
      resourceKeyFromManagedPath("~/.claude/skills/manual-skill/SKILL.md"),
    ).toEqual({ type: "skill", name: "manual-skill" });
    expect(
      resourceKeyFromManagedPath(".cursor/skills/manual-skill/SKILL.md"),
    ).toEqual({ type: "skill", name: "manual-skill" });
    expect(
      resourceKeyFromManagedPath(".agents/skills/manual-skill/SKILL.md"),
    ).toEqual({ type: "skill", name: "manual-skill" });
    expect(
      resourceKeyFromManagedPath(".claude/agents/helper.md"),
    ).toEqual({ type: "agent", name: "helper" });
    expect(
      resourceKeyFromManagedPath(".cursor/rules/always.mdc"),
    ).toEqual({ type: "rule", name: "always" });
    expect(isMcpConfigManagedPath(".cursor/mcp.json")).toBe(true);
    expect(isMcpConfigManagedPath(".mcp.json")).toBe(true);
    expect(isMcpConfigManagedPath("~/.claude.json")).toBe(true);
    expect(isMcpConfigManagedPath(".claude.json")).toBe(true);
    expect(isMcpConfigManagedPath(".copilot/mcp-config.json")).toBe(true);
    expect(isMcpConfigManagedPath("~/.copilot/mcp-config.json")).toBe(true);
    expect(isMcpConfigManagedPath(".agents/mcp_config.json")).toBe(true);
    expect(isMcpConfigManagedPath("opencode.json")).toBe(true);
  });

  it("maps harness settings and hooks files as aggregate config paths", () => {
    expect(resourceKeyFromManagedPath(".claude/settings.json")).toBeNull();
    expect(resourceKeyFromManagedPath("~/.claude/settings.json")).toBeNull();
    expect(isAggregateConfigManagedPath(".claude/settings.json")).toBe(true);
    expect(isAggregateConfigManagedPath("~/.claude/settings.json")).toBe(true);
    expect(isAggregateConfigManagedPath(".cursor/hooks.json")).toBe(true);
    expect(isAggregateConfigManagedPath("~/.cursor/hooks.json")).toBe(true);
    expect(isAggregateConfigManagedPath("~/.config/muse/settings.json")).toBe(true);
    expect(isAggregateConfigManagedPath(".codex/config.toml")).toBe(true);
    expect(isAggregateConfigManagedPath(".claude/skills/manual-skill/SKILL.md")).toBe(
      false,
    );
  });

  it("maps OpenCode and other registry harness skill paths", () => {
    const skill = { type: "skill", name: "capsule-handover" };
    expect(
      resourceKeyFromManagedPath(
        ".config/opencode/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath(
        "~/.config/opencode/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath(
        ".opencode/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath(
        ".gemini/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath(
        ".codeium/windsurf/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath(
        ".grok/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath(
        ".config/crush/skills/capsule-handover/SKILL.md",
      ),
    ).toEqual(skill);
    expect(
      resourceKeyFromManagedPath("opencode.json"),
    ).toBeNull();
  });

  it("maps OpenCode agent and command paths from the registry", () => {
    expect(
      resourceKeyFromManagedPath(".opencode/agents/helper.md"),
    ).toEqual({ type: "agent", name: "helper" });
    expect(
      resourceKeyFromManagedPath(".config/opencode/agents/helper.md"),
    ).toEqual({ type: "agent", name: "helper" });
    expect(
      resourceKeyFromManagedPath(".opencode/commands/test.md"),
    ).toEqual({ type: "command", name: "test" });
    expect(
      resourceKeyFromManagedPath(".opencode/command/ponytail.md"),
    ).toEqual({ type: "command", name: "ponytail" });
  });

  it("commits modified managed skill content from live disk into the library", async () => {
    const context = await createInitializedTestContext("profile-commit-managed");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const skillPath = join(
        context.homeDir,
        ".claude/skills/manual-skill/SKILL.md",
      );
      mkdirSync(join(context.homeDir, ".claude/skills/manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        skillPath,
        "---\nname: manual-skill\ndescription: updated\n---\n\n# updated live",
        "utf-8",
      );

      const committed = await commitManagedResourceFromLive({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
        harness: "claude-code",
        path: ".claude/skills/manual-skill/SKILL.md",
      });

      expect(committed.name).toBe("manual-skill");
      const library = getResource(skill.id);
      expect(library?.content).toContain("# updated live");
      expect(getPluginById(profile.id)?.dirty).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("commits live mcp.json into profile mcp_server resources", async () => {
    const context = await createInitializedTestContext("profile-commit-mcp");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const mcp = createResource({
        type: "mcp_server",
        name: "alpha",
        description: "",
        content: "",
        metadata: { transport: "http", url: "https://example.com/old" },
        source: "~/.cursor/mcp.json",
      });
      addResourceToPlugin(profile.id, mcp.id);

      await applyProfilePlugin("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });

      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".cursor", "mcp.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              alpha: { url: "https://example.com/new" },
              beta: { url: "https://example.com/beta" },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const committed = await commitManagedPathFromLive({
        profileSelector: "work",
        path: ".cursor/mcp.json",
        scope: "home",
        harness: "cursor",
      });

      expect(committed.map((entry) => entry.name).sort()).toEqual(["alpha", "beta"]);
      const library = listResources().filter((entry) => entry.type === "mcp_server");
      expect(library.some((entry) => entry.name === "beta")).toBe(true);
      const alpha = library.find((entry) => entry.name === "alpha");
      expect(alpha?.metadata).toMatchObject({ url: "https://example.com/new" });

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "cursor",
      });
      // Profile now includes both live servers; semantic MCP compare clears file drift.
      expect(preview.contents?.mcp_servers?.sort()).toEqual(["alpha", "beta"]);
      expect(
        preview.files?.changes.some((change) => change.path === ".cursor/mcp.json"),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("commits live .copilot/mcp-config.json into profile mcp_server resources", async () => {
    const context = await createInitializedTestContext("profile-commit-copilot-mcp");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const cursorMcp = createResource({
        type: "mcp_server",
        name: "cursor-only",
        description: "",
        content: "",
        metadata: { transport: "http", url: "https://example.com/cursor" },
        source: "~/.cursor/mcp.json",
      });
      const mcp = createResource({
        type: "mcp_server",
        name: "alpha",
        description: "",
        content: "",
        metadata: { transport: "http", url: "https://example.com/old" },
        source: "~/.copilot/mcp-config.json",
      });
      addResourceToPlugin(profile.id, cursorMcp.id);
      addResourceToPlugin(profile.id, mcp.id);

      await applyProfilePlugin("work", {
        harness: "copilot-cli",
        conflictPolicy: "replace",
      });

      mkdirSync(join(context.homeDir, ".copilot"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".copilot", "mcp-config.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              alpha: { url: "https://example.com/new" },
              beta: { url: "https://example.com/beta" },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const committed = await commitManagedPathFromLive({
        profileSelector: "work",
        path: ".copilot/mcp-config.json",
        scope: "home",
        harness: "copilot-cli",
      });

      expect(committed.map((entry) => entry.name).sort()).toEqual(["alpha", "beta"]);
      const alpha = listResources().find(
        (entry) => entry.type === "mcp_server" && entry.name === "alpha",
      );
      expect(alpha?.metadata).toMatchObject({ url: "https://example.com/new" });

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "copilot-cli",
      });
      expect(
        preview.files?.changes.some(
          (change) => change.path === ".copilot/mcp-config.json",
        ),
      ).toBe(false);
      // Cursor-sourced servers remain in the profile, but do not emit into Copilot.
      expect(
        listResources().some(
          (entry) => entry.type === "mcp_server" && entry.name === "cursor-only",
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("commits live .claude/settings.json permissions and env into the profile", async () => {
    const context = await createInitializedTestContext("profile-commit-claude-settings");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const permission = createResource({
        type: "permission",
        name: "allow-Read(*)",
        description: "",
        content: "",
        metadata: { action: "allow", pattern: "Read(*)" },
        source: "~/.claude/settings.json",
      });
      const envVar = createResource({
        type: "env_var",
        name: "FOO",
        description: "",
        content: "",
        metadata: { key: "FOO", value: "old" },
        source: "~/.claude/settings.json",
      });
      addResourceToPlugin(profile.id, permission.id);
      addResourceToPlugin(profile.id, envVar.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            permissions: { allow: ["Read(*)", "Bash(*)"], deny: [] },
            env: { FOO: "new" },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const committed = await commitManagedPathFromLive({
        profileSelector: "work",
        path: ".claude/settings.json",
        scope: "home",
        harness: "claude-code",
      });

      expect(committed.map((entry) => `${entry.type}:${entry.name}`).sort()).toEqual([
        "env_var:FOO",
        "permission:allow-Bash(*)",
        "permission:allow-Read(*)",
      ]);
      const foo = listResources().find(
        (entry) => entry.type === "env_var" && entry.name === "FOO",
      );
      expect(foo?.metadata).toMatchObject({ key: "FOO", value: "new" });
      expect(
        listResources().some(
          (entry) => entry.type === "permission" && entry.name === "allow-Bash(*)",
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("commits live .cursor/hooks.json into profile hook resources", async () => {
    const context = await createInitializedTestContext("profile-commit-cursor-hooks");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const hook = createResource({
        type: "hook",
        name: "sessionStart-1",
        description: "",
        content: "",
        metadata: { event: "sessionStart", script: "echo old" },
        source: ".cursor/hooks.json",
      });
      addResourceToPlugin(profile.id, hook.id);

      mkdirSync(join(context.projectDir, ".cursor"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".cursor", "hooks.json"),
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              sessionStart: [{ command: "echo new" }],
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const committed = await commitManagedPathFromLive({
        profileSelector: "work",
        path: ".cursor/hooks.json",
        scope: "project",
        projectPath: context.projectDir,
        harness: "cursor",
      });

      expect(committed.some((entry) => entry.type === "hook")).toBe(true);
      const library = listResources().find(
        (entry) => entry.type === "hook" && entry.name === "sessionStart-1",
      );
      expect(library?.metadata).toMatchObject({
        event: "sessionStart",
        script: "echo new",
      });
    } finally {
      await context.cleanup();
    }
  });
});
