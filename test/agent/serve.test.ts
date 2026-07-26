import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  isAuthorizedAgentRequest,
  parseBearerToken,
  requireAgentBearerAuth,
} from "../../src/agent/auth.ts";
import {
  DEFAULT_AGENT_PORT,
  startAgentServer,
} from "../../src/agent/serve.ts";
import {
  AGENT_TOKEN_FILENAME,
  getAgentTokenPath,
} from "../../src/agent/token.ts";
import { getDbPath } from "../../src/db/connection.ts";

describe("agent auth", () => {
  it("parses bearer tokens", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
    expect(parseBearerToken("Basic abc123")).toBeUndefined();
    expect(parseBearerToken(null)).toBeUndefined();
  });

  it("rejects missing or invalid bearer tokens", () => {
    const request = new Request("http://127.0.0.1/v1/switch", {
      method: "POST",
    });
    expect(isAuthorizedAgentRequest(request, "secret")).toBe(false);
    expect(requireAgentBearerAuth(request, "secret")?.status).toBe(401);
  });

  it("accepts matching bearer tokens", () => {
    const request = new Request("http://127.0.0.1/v1/switch", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    });
    expect(isAuthorizedAgentRequest(request, "secret")).toBe(true);
    expect(requireAgentBearerAuth(request, "secret")).toBeUndefined();
  });
});

describe("agent serve", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void }> = [];

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

  function withIsolatedHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    return dir;
  }

  it("boots sqlite, serves /v1/health, and writes the session token file", async () => {
    const home = withIsolatedHome();
    const server = startAgentServer({ port: 0 });
    servers.push(server);

    expect(existsSync(getDbPath())).toBe(true);
    expect(server.port).toBeGreaterThan(0);

    const response = await fetch(`${server.url}/v1/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      version: expect.any(String),
      port: server.port,
    });

    const tokenPath = join(home, AGENT_TOKEN_FILENAME);
    expect(tokenPath).toBe(getAgentTokenPath());
    expect(readFileSync(tokenPath, "utf8").trim()).toBe(server.token);
  });

  it("uses the default port when available", () => {
    withIsolatedHome();
    const server = startAgentServer();
    servers.push(server);
    expect(server.port).toBe(DEFAULT_AGENT_PORT);
  });

  it("requires bearer auth for mutating routes", async () => {
    withIsolatedHome();
    const server = startAgentServer({ port: 0 });
    servers.push(server);

    const unauthorized = await fetch(`${server.url}/v1/switch`, {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${server.url}/v1/switch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: "home" }),
    });
    expect(authorized.status).toBe(400);
  });
});
