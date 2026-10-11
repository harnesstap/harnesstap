import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin, addResourceToPlugin, setPluginTags, getPluginById } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.js";
import { createInitializedTestContext } from "../helpers/db.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { listResources } from "../../src/models/resource.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  addResourceToProfile,
  detectNotStagedProfileResources,
  detectUntrackedProfileResources,
  discardAllLiveResourcesFromHarness,
  discardLiveResourceFromHarness,
} from "../../src/services/profile-untracked-resources.ts";
import * as scanner from "../../src/services/scanner.ts";

describe("profile-untracked-resources service", () => {
  it("detects harness resources not attached to the profile", async () => {
    const context = await createInitializedTestContext("profile-untracked-detect");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "skill",
          name: "kept-skill",
          description: "",
          content: "# kept",
          metadata: {},
          source: "manual",
        }).id,
      );

      mkdirSync(join(context.homeDir, ".claude", "skills", "manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "manual-skill", "SKILL.md"),
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const untracked = await detectUntrackedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });

      expect(untracked.some((resource) => resource.name === "manual-skill")).toBe(true);
      expect(untracked.some((resource) => resource.name === "kept-skill")).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("discards an untracked resource from the live harness", async () => {
    const context = await createInitializedTestContext("profile-untracked-discard");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      const skillDir = join(context.homeDir, ".claude", "skills", "manual-skill");
      mkdirSync(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      writeFileSync(
        skillPath,
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const discarded = await discardLiveResourceFromHarness({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
        harness: "claude-code",
      });

      expect(discarded.resource.name).toBe("manual-skill");
      expect(discarded.removed_paths.length).toBeGreaterThan(0);
      const remaining = await detectUntrackedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(remaining.some((resource) => resource.name === "manual-skill")).toBe(
        false,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("discards scanned live files when the main harness is not the scan source", async () => {
    const context = await createInitializedTestContext(
      "profile-untracked-discard-mismatch",
    );
    try {
      setHarnessPreference({ registered_harnesses: ["cursor"] });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      const skillDir = join(context.homeDir, ".claude", "skills", "manual-skill");
      mkdirSync(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      writeFileSync(
        skillPath,
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const discarded = await discardLiveResourceFromHarness({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
      });

      expect(discarded.resource.name).toBe("manual-skill");
      expect(existsSync(skillPath)).toBe(false);
      const remaining = await detectUntrackedProfileResources({
        profileSelector: "work",
        scope: "home",
      });
      expect(remaining.some((resource) => resource.name === "manual-skill")).toBe(
        false,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("discards all not-in-profile scan sources regardless of main harness", async () => {
    const context = await createInitializedTestContext(
      "profile-untracked-discard-all-mismatch",
    );
    try {
      setHarnessPreference({ registered_harnesses: ["cursor"] });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      const firstDir = join(context.homeDir, ".claude", "skills", "agent-creator");
      const secondDir = join(context.homeDir, ".claude", "skills", "analyst");
      mkdirSync(firstDir, { recursive: true });
      mkdirSync(secondDir, { recursive: true });
      writeFileSync(
        join(firstDir, "SKILL.md"),
        "---\nname: agent-creator\ndescription: a\n---\n\n# a",
        "utf-8",
      );
      writeFileSync(
        join(secondDir, "SKILL.md"),
        "---\nname: analyst\ndescription: b\n---\n\n# b",
        "utf-8",
      );

      const discarded = await discardAllLiveResourcesFromHarness({
        profileSelector: "work",
        scope: "home",
      });

      expect(discarded.discarded_count).toBeGreaterThanOrEqual(2);
      expect(existsSync(join(firstDir, "SKILL.md"))).toBe(false);
      expect(existsSync(join(secondDir, "SKILL.md"))).toBe(false);
      const remaining = await detectUntrackedProfileResources({
        profileSelector: "work",
        scope: "home",
      });
      expect(remaining.some((resource) => resource.name === "agent-creator")).toBe(
        false,
      );
      expect(remaining.some((resource) => resource.name === "analyst")).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("bulk-discards many skills with one home rescan, not per file", async () => {
    const context = await createInitializedTestContext(
      "profile-untracked-discard-all-bulk",
    );
    try {
      const originalScan = scanner.scanHomeDefaults;
      const originalReconcile = scanner.reconcileLocalSnapshotScan;
      let homeScanCount = 0;
      let reconcileCount = 0;
      const scanSpy = spyOn(scanner, "scanHomeDefaults").mockImplementation(
        async (...args) => {
          homeScanCount += 1;
          return originalScan(...args);
        },
      );
      const reconcileSpy = spyOn(scanner, "reconcileLocalSnapshotScan").mockImplementation(
        (...args) => {
          reconcileCount += 1;
          return originalReconcile(...args);
        },
      );

      setHarnessPreference({ registered_harnesses: ["cursor"] });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      const skillNames = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
      for (const name of skillNames) {
        const dir = join(context.homeDir, ".claude", "skills", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}`,
          "utf-8",
        );
      }
      const cacheSkill = join(
        context.homeDir,
        ".claude/plugins/cache/market/demo/1.0.0/skills/cached-skill",
      );
      mkdirSync(cacheSkill, { recursive: true });
      const cachePath = join(cacheSkill, "SKILL.md");
      writeFileSync(
        cachePath,
        "---\nname: cached-skill\ndescription: cache\n---\n\n# cache",
        "utf-8",
      );

      const discarded = await discardAllLiveResourcesFromHarness({
        profileSelector: "work",
        scope: "home",
        resources: skillNames.map((name) => ({
          resourceType: "skill",
          resourceName: name,
        })),
      });

      expect(discarded.discarded_count).toBe(skillNames.length);
      for (const name of skillNames) {
        expect(
          existsSync(join(context.homeDir, ".claude", "skills", name, "SKILL.md")),
        ).toBe(false);
      }
      expect(existsSync(cachePath)).toBe(true);
      expect(homeScanCount).toBe(2);
      expect(reconcileCount).toBe(1);
      scanSpy.mockRestore();
      reconcileSpy.mockRestore();
    } finally {
      await context.cleanup();
    }
  });

  it("discards the same skill in every harness without touching the HT package cache", async () => {
    const context = await createInitializedTestContext(
      "profile-untracked-discard-multi-harness",
    );
    try {
      setHarnessPreference({ registered_harnesses: ["cursor", "claude-code"],
      });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      const claudeDir = join(context.homeDir, ".claude", "skills", "manual-skill");
      const cursorDir = join(context.homeDir, ".cursor", "skills", "manual-skill");
      mkdirSync(claudeDir, { recursive: true });
      mkdirSync(cursorDir, { recursive: true });
      const skillBody = "---\nname: manual-skill\ndescription: manual\n---\n\n# manual";
      writeFileSync(join(claudeDir, "SKILL.md"), skillBody, "utf-8");
      writeFileSync(join(cursorDir, "SKILL.md"), skillBody, "utf-8");

      const cacheFile = join(
        getHarnesstapDir(),
        "cache",
        "packages",
        "host-plugin",
        "mp",
        "keep",
        "1.0.0",
        "README.md",
      );
      mkdirSync(join(cacheFile, ".."), { recursive: true });
      writeFileSync(cacheFile, "keep-me", "utf-8");

      const discarded = await discardLiveResourceFromHarness({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
        harness: "cursor",
      });

      expect(discarded.removed_paths.length).toBeGreaterThanOrEqual(2);
      expect(existsSync(join(claudeDir, "SKILL.md"))).toBe(false);
      expect(existsSync(join(cursorDir, "SKILL.md"))).toBe(false);
      expect(existsSync(cacheFile)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps Cursor host-managed skills-cursor files when discarding harness copies", async () => {
    const context = await createInitializedTestContext(
      "profile-untracked-discard-skills-cursor",
    );
    try {
      setHarnessPreference({ registered_harnesses: ["cursor", "claude-code"],
      });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      const skillBody =
        "---\nname: create-skill\ndescription: create\n---\n\n# create";
      const claudeDir = join(context.homeDir, ".claude", "skills", "create-skill");
      const cursorUserDir = join(context.homeDir, ".cursor", "skills", "create-skill");
      const agentsDir = join(context.homeDir, ".agents", "skills", "create-skill");
      const hostDir = join(context.homeDir, ".cursor", "skills-cursor", "create-skill");
      for (const dir of [claudeDir, cursorUserDir, agentsDir, hostDir]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), skillBody, "utf-8");
      }
      const cacheFile = join(
        getHarnesstapDir(),
        "cache",
        "packages",
        "host-plugin",
        "mp",
        "keep",
        "1.0.0",
        "README.md",
      );
      mkdirSync(join(cacheFile, ".."), { recursive: true });
      writeFileSync(cacheFile, "keep-me", "utf-8");

      const discarded = await discardAllLiveResourcesFromHarness({
        profileSelector: "work",
        scope: "home",
      });

      expect(discarded.discarded_count).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(claudeDir, "SKILL.md"))).toBe(false);
      expect(existsSync(join(cursorUserDir, "SKILL.md"))).toBe(false);
      // `.agents/skills` is a shared tree. Warp/Jules are not registered here,
      // so discard must not treat that folder as a managed harness copy.
      expect(existsSync(join(agentsDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(hostDir, "SKILL.md"))).toBe(true);
      expect(existsSync(cacheFile)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("discards a subset without leaving sibling live files", async () => {
    const context = await createInitializedTestContext(
      "profile-untracked-discard-subset",
    );
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      for (const name of ["keep-skill", "drop-skill"]) {
        const dir = join(context.homeDir, ".claude", "skills", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}`,
          "utf-8",
        );
      }

      await discardAllLiveResourcesFromHarness({
        profileSelector: "work",
        scope: "home",
        resources: [{ resourceType: "skill", resourceName: "drop-skill" }],
      });

      expect(
        existsSync(join(context.homeDir, ".claude", "skills", "drop-skill", "SKILL.md")),
      ).toBe(false);
      expect(
        existsSync(join(context.homeDir, ".claude", "skills", "keep-skill", "SKILL.md")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("adds an untracked resource to the profile plugin", async () => {
    const context = await createInitializedTestContext("profile-untracked-add");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      setActiveProfileName("work");

      mkdirSync(join(context.homeDir, ".claude", "skills", "manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "manual-skill", "SKILL.md"),
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const added = await addResourceToProfile({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
        harness: "claude-code",
      });

      expect(added.name).toBe("manual-skill");
      const remaining = await detectUntrackedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(remaining.some((resource) => resource.name === "manual-skill")).toBe(false);
      expect(getPluginById(profile.id)?.dirty).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("lists extra permissions from settings.json even when the profile owns that file", async () => {
    const context = await createInitializedTestContext("profile-not-staged-extra-perm");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "permission",
          name: "allow-Bash(*)",
          description: "",
          content: "",
          metadata: { action: "allow", pattern: "Bash(*)" },
          source: "manual",
        }).id,
      );

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      // Extra permission on disk not in the profile
      const settingsPath = join(context.homeDir, ".claude", "settings.json");
      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify(
          { permissions: { allow: ["Bash(*)"], deny: [] } },
          null,
          2,
        ),
        "utf-8",
      );
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        permissions?: { allow?: string[]; deny?: string[] };
      };
      const allow = new Set(settings.permissions?.allow ?? []);
      allow.add("Read(*)");
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            ...settings,
            permissions: {
              allow: [...allow],
              deny: settings.permissions?.deny ?? [],
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });

      expect(
        notStaged.some(
          (resource) =>
            resource.type === "permission" && resource.name === "allow-Read(*)",
        ),
      ).toBe(true);
      expect(
        notStaged.some(
          (resource) =>
            resource.type === "permission" && resource.name === "allow-Bash(*)",
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("does not treat profile-owned instruction files as not staged under synthetic names", async () => {
    const context = await createInitializedTestContext("profile-not-staged-instruction");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "instruction",
          name: "intro",
          description: "",
          content: "# intro from profile",
          metadata: {},
          source: "manual",
        }).id,
      );

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });

      expect(
        notStaged.some((resource) => resource.name === "claude-instructions"),
      ).toBe(false);
      expect(notStaged.some((resource) => resource.name === "intro")).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("offers skills attached to another profile as not staged for the current profile", async () => {
    const context = await createInitializedTestContext("profile-not-staged-other-profile");
    try {
      const profileA = createPlugin({ name: "profile-a" });
      setPluginTags(profileA.id, ["profile"]);
      addResourceToPlugin(
        profileA.id,
        createResource({
          type: "skill",
          name: "shared-skill",
          description: "",
          content: "# shared",
          metadata: {},
          source: "manual",
        }).id,
      );

      const profileB = createPlugin({ name: "profile-b" });
      setPluginTags(profileB.id, ["profile"]);

      await applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "profile-b",
        scope: "home",
        harness: "claude-code",
      });

      expect(notStaged.some((resource) => resource.name === "shared-skill")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("lists extra MCP servers from mcp.json even when the profile owns that file", async () => {
    const context = await createInitializedTestContext("profile-not-staged-extra-mcp");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "docs",
          description: "",
          content: "",
          metadata: { transport: "stdio", command: "docs-mcp" },
          source: "manual",
        }).id,
      );

      await applyProfilePlugin("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      const mcpPath = join(context.homeDir, ".cursor", "mcp.json");
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(
        mcpPath,
        JSON.stringify(
          {
            mcpServers: {
              docs: { command: "docs-mcp" },
              "mcp-agency-sandbox-public": {
                command: "npx",
                args: ["-y", "agency-sandbox"],
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "cursor",
      });

      expect(
        notStaged.some(
          (resource) =>
            resource.type === "mcp_server"
            && resource.name === "mcp-agency-sandbox-public",
        ),
      ).toBe(true);
      expect(
        notStaged.some(
          (resource) => resource.type === "mcp_server" && resource.name === "docs",
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("registers not-staged resources as live library refs without snapshotting content", async () => {
    const context = await createInitializedTestContext("profile-not-staged-live-ref");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);

      mkdirSync(join(context.homeDir, ".claude", "skills", "manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "manual-skill", "SKILL.md"),
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual body",
        "utf-8",
      );

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });
      const entry = notStaged.find((resource) => resource.name === "manual-skill");
      expect(entry).toBeTruthy();
      if (!entry) {
        return;
      }

      const library = listResources().find((resource) => resource.id === entry.id);
      expect(library).toBeTruthy();
      if (!library) {
        return;
      }
      expect(
        (library.metadata as Record<string, unknown>).content_status,
      ).toBe("live");
      expect(library.content).toBe("");
    } finally {
      await context.cleanup();
    }
  });

  it("lists on-disk skill edits as not-staged updates when the profile snapshot differs", async () => {
    const context = await createInitializedTestContext("profile-not-staged-skill-update");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "skill",
          name: "dolibarr-api",
          description: "thin",
          content: "short body",
          metadata: {},
          source: "manual",
        }).id,
      );

      mkdirSync(join(context.homeDir, ".claude", "skills", "dolibarr-api"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "dolibarr-api", "SKILL.md"),
        [
          "---",
          "name: dolibarr-api",
          "description: thin",
          "allowed-tools: Bash",
          "---",
          "",
          "short body",
          "",
          "# Dolibarr API operations",
          "## Prerequisites",
          "Need DOLIBARR_URL",
        ].join("\n"),
        "utf-8",
      );

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });
      const entry = notStaged.find(
        (resource) => resource.type === "skill" && resource.name === "dolibarr-api",
      );
      expect(entry?.not_staged_kind).toBe("update");

      const updated = await addResourceToProfile({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "dolibarr-api",
        scope: "home",
        harness: "claude-code",
      });
      expect(updated.name).toBe("dolibarr-api");
      const library = listResources().find(
        (resource) =>
          resource.type === "skill" && resource.name === "dolibarr-api",
      );
      expect(library?.content).toContain("# Dolibarr API operations");

      const remaining = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(
        remaining.some(
          (resource) => resource.type === "skill" && resource.name === "dolibarr-api",
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});

describe("agent profile add-resource routes", () => {
  const previousHarnessTapHome = process.env.HARNESSTAP_HOME;
  const previousHome = process.env.HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    restoreEnv("HARNESSTAP_HOME", previousHarnessTapHome);
    restoreEnv("HOME", previousHome);
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-add-resource-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return { ...server, home: dir };
  }

  it("returns untracked resources in apply preview", async () => {
    const server = await withServer();
    const profile = createPlugin({ name: "work" });
    setPluginTags(profile.id, ["profile"]);

    mkdirSync(join(server.home, ".claude", "skills", "manual-skill"), {
      recursive: true,
    });
    writeFileSync(
      join(server.home, ".claude", "skills", "manual-skill", "SKILL.md"),
      "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      "utf-8",
    );

    const response = await fetch(`${server.url}/v1/profiles/apply-preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ profile: "work", scope: "home", harness: "claude-code" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      untracked_resources: Array<{ name: string }>;
    };
    expect(body.untracked_resources.some((resource) => resource.name === "manual-skill")).toBe(
      true,
    );
  });

  it("adds a resource via POST /v1/profiles/:name/add-resource", async () => {
    const server = await withServer();
    const profile = createPlugin({ name: "work" });
    setPluginTags(profile.id, ["profile"]);

    mkdirSync(join(server.home, ".claude", "skills", "manual-skill"), {
      recursive: true,
    });
    writeFileSync(
      join(server.home, ".claude", "skills", "manual-skill", "SKILL.md"),
      "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      "utf-8",
    );

    const response = await fetch(`${server.url}/v1/profiles/work/add-resource`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
        harness: "claude-code",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: { name: string } };
    expect(body.resource.name).toBe("manual-skill");
  });

  it("adds all untracked resources via POST /v1/profiles/:name/add-all-resources", async () => {
    const server = await withServer();
    const profile = createPlugin({ name: "work" });
    setPluginTags(profile.id, ["profile"]);
    addResourceToPlugin(
      profile.id,
      createResource({
        type: "skill",
        name: "kept",
        description: "",
        content: "# kept",
        metadata: {},
        source: "manual",
      }).id,
    );

    mkdirSync(join(server.home, ".claude", "skills", "manual-one"), { recursive: true });
    writeFileSync(
      join(server.home, ".claude", "skills", "manual-one/SKILL.md"),
      "---\nname: manual-one\ndescription: one\n---\n\n# one",
      "utf-8",
    );
    mkdirSync(join(server.home, ".claude", "skills", "manual-two"), { recursive: true });
    writeFileSync(
      join(server.home, ".claude", "skills", "manual-two/SKILL.md"),
      "---\nname: manual-two\ndescription: two\n---\n\n# two",
      "utf-8",
    );

    const response = await fetch(`${server.url}/v1/profiles/work/add-all-resources`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ scope: "home", harness: "claude-code" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      added_count: number;
      resources: Array<{ name: string }>;
    };
    expect(body.added_count).toBe(2);
    expect(body.resources.map((resource) => resource.name).sort()).toEqual([
      "manual-one",
      "manual-two",
    ]);

    const remaining = await detectUntrackedProfileResources({
      profileSelector: "work",
      scope: "home",
      harness: "claude-code",
    });
    expect(remaining).toHaveLength(0);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
