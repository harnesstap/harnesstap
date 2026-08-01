import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.js";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addResourceToProfile,
  detectUntrackedProfileResources,
} from "../../src/services/profile-untracked-resources.ts";

describe("profile-untracked-resources service", () => {
  it("detects harness resources not attached to the profile", async () => {
    const context = await createInitializedTestContext("profile-untracked-detect");
    try {
      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
      addResourceToLayer(
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

  it("adds an untracked resource to the profile layer", async () => {
    const context = await createInitializedTestContext("profile-untracked-add");
    try {
      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
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

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-add-resource-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return { ...server, home: dir };
  }

  it("returns untracked resources in apply preview", async () => {
    const server = withServer();
    const profile = createLayer({ name: "work" });
    setLayerTags(profile.id, ["profile"]);

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
    const server = withServer();
    const profile = createLayer({ name: "work" });
    setLayerTags(profile.id, ["profile"]);

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
    const server = withServer();
    const profile = createLayer({ name: "work" });
    setLayerTags(profile.id, ["profile"]);
    addResourceToLayer(
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
