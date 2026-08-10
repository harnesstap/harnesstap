import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";

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

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-library-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("lists plugins and resources with bearer auth", async () => {
    const server = withServer();
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
  });

  it("returns on-disk content for untracked resource selectors", async () => {
    const server = withServer();
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
});
