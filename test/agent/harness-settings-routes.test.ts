import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";

describe("agent harness settings routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-harness-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("GET /v1/harness requires auth and returns payload", async () => {
    const server = await withServer();
    setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"],
    });

    const unauth = await fetch(`${server.url}/v1/harness`);
    expect(unauth.status).toBe(401);

    const response = await fetch(`${server.url}/v1/harness`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.global.registered_harnesses).toEqual(["claude-code", "cursor"]);
    expect(body.harnesses.length).toBeGreaterThan(0);
  });

  it("PUT /v1/harness updates global preference", async () => {
    const server = await withServer();
    const response = await fetch(`${server.url}/v1/harness`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        global: { registered_harnesses: ["cursor", "codex"] },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.global).toEqual({ registered_harnesses: ["cursor", "codex"],
    });

    const get = await fetch(`${server.url}/v1/harness`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    const loaded = await get.json();
    expect(loaded.global.registered_harnesses).toEqual(["cursor", "codex"]);
  });
});
