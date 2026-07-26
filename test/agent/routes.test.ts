import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";

describe("agent routes", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-routes-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("lists personas and serves status without auth", async () => {
    const server = withServer();

    const personas = await fetch(`${server.url}/v1/personas`);
    expect(personas.status).toBe(200);
    await expect(personas.json()).resolves.toEqual({ personas: expect.any(Array) });

    const status = await fetch(`${server.url}/v1/status?depth=fast`);
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.panel).toBeDefined();
    expect(body.depth).toBe("fast");
    expect(body.switching).toBe(false);
  });

  it("rejects switch without bearer token", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "work", scope: "home" }),
    });
    expect(response.status).toBe(401);
  });
});
