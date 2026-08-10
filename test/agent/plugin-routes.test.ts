import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";

describe("agent plugin routes", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-plugin-routes-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("serves GET /v1/library/plugins", async () => {
    const server = withServer();
    createPlugin({ name: "eng", description: "Engineering" });

    const response = await fetch(`${server.url}/v1/library/plugins`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plugins: unknown[] };
    expect(Array.isArray(body.plugins)).toBe(true);
    expect(
      body.plugins.some((row) => (row as { name: string }).name === "eng"),
    ).toBe(true);
  });

  it("accepts pluginIds on POST /v1/profiles", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/profiles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "work",
        source: "compose",
        pluginIds: [],
      }),
    });
    expect(response.status).toBeLessThan(500);
  });

  it("reports invalid_plugin_id rather than invalid_layer_id", async () => {
    const server = withServer();
    createProfileCommand({ name: "work" });

    const response = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent("work")}/remove-resource`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resourceType: "skill",
          resourceName: "missing",
          pluginId: 123,
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("invalid_plugin_id");
  });

  it("uses scope=plugin for migrate export", async () => {
    const server = withServer();
    createPlugin({ name: "base", description: "Base plugin" });
    const outputPath = join(tempDirs.at(-1)!, "base.harnesstap.toml");

    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "plugin",
        plugin: "base",
        path: outputPath,
      }),
    });
    expect(response.status).toBeLessThan(500);
  });
});
