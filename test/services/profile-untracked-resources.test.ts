import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin, addResourceToPlugin, setPluginTags, getPluginById } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.js";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addResourceToProfile,
  detectNotStagedProfileResources,
  detectUntrackedProfileResources,
} from "../../src/services/profile-untracked-resources.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { listResources } from "../../src/models/resource.ts";

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

  it("treats resources attached to another profile as staged (not listed)", async () => {
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
        false,
      );
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
