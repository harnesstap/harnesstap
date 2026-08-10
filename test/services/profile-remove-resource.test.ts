import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginResources,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { removeResourceFromProfile } from "../../src/services/profile-remove-resource.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("profile-remove-resource service", () => {
  it("removes a resource attached to the profile plugin", async () => {
    const context = await createInitializedTestContext("profile-remove-resource");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "demo-skill",
        description: "",
        content: "# demo",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);

      const removed = removeResourceFromProfile({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "demo-skill",
        pluginId: profile.id,
      });

      expect(removed.name).toBe("demo-skill");
      expect(getPluginResources(profile.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("errors when the resource is not attached to the profile", async () => {
    const context = await createInitializedTestContext("profile-remove-missing");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      createResource({
        type: "skill",
        name: "orphan-skill",
        description: "",
        content: "# orphan",
        metadata: {},
        source: "manual",
      });

      expect(() =>
        removeResourceFromProfile({
          profileSelector: "work",
          resourceType: "skill",
          resourceName: "orphan-skill",
        }),
      ).toThrow("Resource is not attached to profile");
    } finally {
      await context.cleanup();
    }
  });
});

describe("agent profile remove-resource route", () => {
  const previousHarnessTapHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHarnessTapHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHarnessTapHome;
    }
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-remove-resource-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("removes a resource via POST /v1/profiles/:name/remove-resource", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "work" });
    setPluginTags(profile.id, ["profile"]);
    const skill = createResource({
      type: "skill",
      name: "demo-skill",
      description: "",
      content: "# demo",
      metadata: {},
      source: "manual",
    });
    addResourceToPlugin(profile.id, skill.id);

    const response = await fetch(`${server.url}/v1/profiles/work/remove-resource`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        resourceType: "skill",
        resourceName: "demo-skill",
        pluginId: profile.id,
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: { name: string } };
    expect(body.resource.name).toBe("demo-skill");
    expect(getPluginResources(profile.id)).toHaveLength(0);
  });
});
