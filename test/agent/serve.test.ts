import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import {
  isAuthorizedAgentRequest,
  parseBearerToken,
  requireAgentBearerAuth,
} from "../../src/agent/auth.ts";
import {
  startAgentServer,
} from "../../src/agent/serve.ts";
import {
  AGENT_TOKEN_FILENAME,
  getAgentTokenPath,
} from "../../src/agent/token.ts";
import { closeDb, getDbPath } from "../../src/db/connection.ts";

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
  const previousOsHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    closeDb();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
    if (previousOsHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousOsHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  });

  function withIsolatedHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    return dir;
  }

  it("boots sqlite, serves /v1/health, and writes the session token file", async () => {
    const home = withIsolatedHome();
    const server = await startAgentServer({ port: 0 });
    servers.push(server);

    expect(existsSync(getDbPath())).toBe(true);
    expect(server.port).toBeGreaterThan(0);

    const response = await fetch(`${server.url}/v1/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "healthy",
      version: expect.any(String),
      port: server.port,
      first_run: true,
    });

    const tokenPath = join(home, AGENT_TOKEN_FILENAME);
    expect(tokenPath).toBe(getAgentTokenPath());
    expect(readFileSync(tokenPath, "utf8").trim()).toBe(server.token);
  });

  it("scans home defaults and seeds the default profile from library resources", async () => {
    const previousOsHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const home = withIsolatedHome();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    mkdirSync(join(home, ".claude", "skills", "research"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "# Home Claude instructions");
    writeFileSync(
      join(home, ".claude", "skills", "research", "SKILL.md"),
      "---\nname: research\ndescription: Home research helper\n---\n# Research\n",
    );

    try {
      const server = await startAgentServer({ port: 0 });
      servers.push(server);

      const health = await fetch(`${server.url}/v1/health`);
      expect(await health.json()).toEqual(
        expect.objectContaining({
          status: "healthy",
          first_run: true,
        }),
      );

      const dirs = await fetch(`${server.url}/v1/library/resource-directories`, {
        headers: { authorization: `Bearer ${server.token}` },
      });
      const dirBody = (await dirs.json()) as {
        directories: Array<{ kind: string; path: string; display_path?: string }>;
      };
      const homeEntry = dirBody.directories.find((entry) => entry.kind === "home_default");
      expect(homeEntry?.path).toBe(home);
      expect(homeEntry?.display_path).toBe("~");

      const { getPluginResources, listPlugins } = await import(
        "../../src/models/plugin-model.ts"
      );
      const defaultPlugin = listPlugins().find((plugin) => plugin.name === "global default");
      expect(defaultPlugin).toBeDefined();
      const attached = getPluginResources(defaultPlugin!.id);
      expect(attached.map((resource) => resource.type).sort()).toEqual([
        "instruction",
        "skill",
      ]);
    } finally {
      if (previousOsHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousOsHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
    }
  });

  it("fails fast when the database schema is newer than this binary", async () => {
    withIsolatedHome();
    mkdirSync(process.env.HARNESSTAP_HOME!, { recursive: true });
    const raw = new Database(getDbPath());
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (99);
    `);
    raw.close();
    closeDb();

    await expect(startAgentServer({ port: 0 })).rejects.toThrow(
      /newer than this binary|schema v99/,
    );
  });

  it("uses the default port when available", async () => {
    withIsolatedHome();
    const server = await startAgentServer({ port: 18_734 });
    servers.push(server);
    expect(server.port).toBe(18_734);
  });

  it("adds CORS headers for loopback browser origins", async () => {
    withIsolatedHome();
    const server = await startAgentServer({ port: 0 });
    servers.push(server);

    const response = await fetch(`${server.url}/v1/health`, {
      headers: { Origin: "http://localhost:1420" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:1420",
    );

    const preflight = await fetch(`${server.url}/v1/switch`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:1420",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:1420",
    );
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT",
    );

    const putPreflight = await fetch(`${server.url}/v1/harness`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:1420",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect(putPreflight.status).toBe(204);
    expect(putPreflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://127.0.0.1:1420",
    );
    expect(putPreflight.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT",
    );
  });

  it("adds CORS headers for the installed Tauri webview origin", async () => {
    withIsolatedHome();
    const server = await startAgentServer({ port: 0 });
    servers.push(server);

    const macOrigin = "tauri://localhost";
    const macResponse = await fetch(`${server.url}/v1/health`, {
      headers: { Origin: macOrigin },
    });
    expect(macResponse.status).toBe(200);
    expect(macResponse.headers.get("Access-Control-Allow-Origin")).toBe(macOrigin);

    const windowsOrigin = "https://tauri.localhost";
    const windowsResponse = await fetch(`${server.url}/v1/health`, {
      headers: { Origin: windowsOrigin },
    });
    expect(windowsResponse.status).toBe(200);
    expect(windowsResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      windowsOrigin,
    );

    const preflight = await fetch(`${server.url}/v1/harness`, {
      method: "OPTIONS",
      headers: {
        Origin: macOrigin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(macOrigin);
  });

  it("requires bearer auth for mutating routes", async () => {
    withIsolatedHome();
    const server = await startAgentServer({ port: 0 });
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
