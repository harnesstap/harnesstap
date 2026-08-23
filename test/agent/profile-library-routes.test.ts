import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin, addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";

describe("agent library routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-library-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("lists plugins and resources with bearer auth", async () => {
    const server = await withServer();
    createPlugin({ name: "eng", description: "Engineering" });
    createResource({
      type: "skill",
      name: "ship",
      description: "Ship skill",
      content: "# ship",
      metadata: {},
      source: "manual",
    });

    const denied = await fetch(`${server.url}/v1/library/plugins`);
    expect(denied.status).toBe(401);

    const plugins = await fetch(`${server.url}/v1/library/plugins`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(plugins.status).toBe(200);
    const pluginBody = await plugins.json();
    expect(pluginBody.plugins.some((l: { name: string }) => l.name === "eng")).toBe(true);

    const resources = await fetch(`${server.url}/v1/library/resources`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(resources.status).toBe(200);
    const resourceBody = await resources.json();
    const ship = resourceBody.resources.find(
      (r: { name: string; source?: string }) => r.name === "ship",
    );
    expect(ship).toBeTruthy();
    expect(ship.source).toBe("manual");
    expect(typeof ship.updated_at).toBe("string");
    expect(ship.updated_at.length).toBeGreaterThan(0);
    expect(ship.origin_kind).toBe("manual");

    const detail = await fetch(
      `${server.url}/v1/library/resources/${encodeURIComponent("skill:ship")}`,
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.resource.name).toBe("ship");
    expect(detailBody.resource.source).toBe("manual");
    expect(detailBody.resource.content).toContain("# ship");
    expect(detailBody.resource.attached_profiles).toEqual([]);
    expect(detailBody.resource.attached_plugins).toEqual([]);
    expect(detailBody.resource.in_active_profile).toBe(false);
  });

  it("lists profile and plugin attachers on resource detail", async () => {
    const server = await withServer();
    const skill = createResource({
      type: "skill",
      name: "shared-ship",
      description: "Ship skill",
      content: "# ship",
      metadata: {},
      source: "manual",
    });
    const profile = createPlugin({ name: "work", tags: ["profile"] });
    const plugin = createPlugin({ name: "formatter", tags: [] });
    addResourceToPlugin(profile.id, skill.id);
    addResourceToPlugin(plugin.id, skill.id);
    setActiveProfileName("work");

    const detail = await fetch(
      `${server.url}/v1/library/resources/${encodeURIComponent("skill:shared-ship")}`,
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.resource.attached_profiles).toEqual(["work"]);
    expect(detailBody.resource.attached_plugins).toEqual(["formatter"]);
    expect(detailBody.resource.active_profile).toBe("work");
    expect(detailBody.resource.in_active_profile).toBe(true);
  });

  it("returns on-disk content for untracked resource selectors", async () => {
    const server = await withServer();
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-untracked-"));
    tempDirs.push(dir);
    const filePath = join(dir, "CLAUDE.md");
    writeFileSync(filePath, "# claude instructions", "utf-8");

    const detail = await fetch(
      `${server.url}/v1/library/resources/${encodeURIComponent("untracked:instruction:claude-instructions")}?path=${encodeURIComponent(filePath)}`,
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.resource.name).toBe("claude-instructions");
    expect(detailBody.resource.type).toBe("instruction");
    expect(detailBody.resource.origin_kind).toBe("untracked");
    expect(detailBody.resource.content).toContain("# claude instructions");
  });

  it("omits plugin extras on skill detail and includes them on plugin detail", async () => {
    const server = await withServer();
    createResource({
      type: "skill",
      name: "ship",
      description: "Ship skill",
      content: "# ship",
      metadata: {},
      source: "manual",
    });
    createResource({
      type: "plugin",
      name: "demo",
      namespace: "team-mkt",
      description: "Plugin pin: demo@team-mkt",
      content: "{}",
      metadata: {},
      source: "composition:plugin",
      origin_kind: "marketplace_link",
      origin_ref: "demo@team-mkt",
    });

    const skill = await fetch(
      `${server.url}/v1/library/resources/${encodeURIComponent("skill:ship")}`,
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(skill.status).toBe(200);
    const skillBody = await skill.json();
    expect(skillBody.resource).not.toHaveProperty("install_path");
    expect(skillBody.resource).not.toHaveProperty("marketplace_url");
    expect(skillBody.resource).not.toHaveProperty("contained_resources");
    expect(skillBody.resource.content).toContain("# ship");

    const plugin = await fetch(
      `${server.url}/v1/library/resources/${encodeURIComponent("plugin:demo@team-mkt")}`,
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(plugin.status).toBe(200);
    const pluginBody = await plugin.json();
    expect(pluginBody.resource).toHaveProperty("install_path");
    expect(pluginBody.resource).toHaveProperty("marketplace_url");
    expect(pluginBody.resource).toHaveProperty("contained_resources");
    expect(Array.isArray(pluginBody.resource.contained_resources)).toBe(true);
  });
});
