import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createEnvironment } from "../../src/models/environment.ts";

describe("agent environment routes", () => {
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

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-env-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("GET /v1/environments requires auth and lists environments", async () => {
    const server = withServer();
    createEnvironment({ name: "staging", description: "stg" });

    const unauth = await fetch(`${server.url}/v1/environments`);
    expect(unauth.status).toBe(401);

    const response = await fetch(`${server.url}/v1/environments`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.environments).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        name: "staging",
        description: "stg",
      }),
    ]);
  });
});
