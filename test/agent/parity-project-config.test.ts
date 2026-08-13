import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/project-config.ts";
import { MISSING_PROJECT_CONFIG_MESSAGE } from "../../src/services/project-config-messages.ts";
import { findProjectConfig } from "../../src/services/project-config.ts";
import { writeStarterProjectConfig } from "../../src/services/project-config-write.ts";
import { startAgentServer } from "../../src/agent/serve.ts";

const TOKEN = "test-token";
const DEPS = { isAgentSwitchInProgress: () => false };

const tempDirs: string[] = [];
const servers: Array<{ stop: () => void; url: string; token: string }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function configRequest(
  projectPath: string | null,
  options?: { token?: string | null; alias?: "projectPath" | "project" },
): Request {
  const url = new URL("http://127.0.0.1/v1/config");
  if (projectPath !== null) {
    url.searchParams.set(options?.alias ?? "projectPath", projectPath);
  }
  const headers = new Headers();
  if (options?.token !== null) {
    headers.set("authorization", `Bearer ${options?.token ?? TOKEN}`);
  }
  return new Request(url, { method: "GET", headers });
}

async function inspect(
  request: Request,
  token = TOKEN,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const response = await tryHandle(request, token, DEPS);
  if (response === null) return null;
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("GET /v1/config tryHandle", () => {
  it("returns null for unrelated method+path so other routes still win", async () => {
    const request = new Request("http://127.0.0.1/v1/health");
    expect(await tryHandle(request, TOKEN, DEPS)).toBeNull();
  });

  it("returns 401 without bearer", async () => {
    const result = await inspect(configRequest("/tmp/project", { token: null }));
    expect(result?.status).toBe(401);
  });

  it("returns 400 projectPath_required when the query is missing", async () => {
    const result = await inspect(configRequest(null));
    expect(result?.status).toBe(400);
    expect(result?.body.error).toBe("projectPath_required");
  });

  it("returns 404 config_not_found with the CLI missing-config message", async () => {
    const dir = tempDir("ht-config-missing-");
    const result = await inspect(configRequest(dir));
    expect(result?.status).toBe(404);
    expect(result?.body.error).toBe("config_not_found");
    expect(result?.body.message).toBe(MISSING_PROJECT_CONFIG_MESSAGE);
  });

  it("returns 200 with validation.valid true after writeStarterProjectConfig", async () => {
    const dir = tempDir("ht-config-valid-");
    writeStarterProjectConfig({
      projectPath: dir,
      defaultProfile: "dev",
      profileNames: ["dev"],
    });
    const result = await inspect(configRequest(dir));
    expect(result?.status).toBe(200);
    const config = result?.body.config as Record<string, unknown>;
    const validation = result?.body.validation as { valid: boolean; errors: string[] };
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(config.default_profile).toBe("dev");
    expect(config.root_path).toBe(dir);
    expect(String(config.config_path)).toContain(".harnesstap/config.toml");
    const resolved = findProjectConfig(dir);
    expect(resolved).not.toBeNull();
    expect(config).toEqual({
      root_path: resolved!.rootPath,
      config_path: resolved!.configPath,
      default_profile: resolved!.default_profile,
      default_environment: resolved!.default_environment,
      profiles: resolved!.profiles,
      environments: resolved!.environments,
      plugins: resolved!.plugins.map((plugin) => ({ name: plugin.name })),
      environment_count: resolved!.environments.length,
      plugin_count: resolved!.plugins.length,
    });
  });

  it("accepts project as a query alias for projectPath", async () => {
    const dir = tempDir("ht-config-alias-");
    writeStarterProjectConfig({
      projectPath: dir,
      defaultProfile: "dev",
      profileNames: ["dev"],
    });
    const result = await inspect(configRequest(dir, { alias: "project" }));
    expect(result?.status).toBe(200);
    expect((result?.body.config as { default_profile: string }).default_profile).toBe("dev");
  });

  it("returns 200 with validation.valid false for unknown default_profile", async () => {
    const dir = tempDir("ht-config-invalid-ref-");
    mkdirSync(join(dir, ".harnesstap"), { recursive: true });
    writeFileSync(
      join(dir, ".harnesstap", "config.toml"),
      `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "missing"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      "utf-8",
    );
    const result = await inspect(configRequest(dir));
    expect(result?.status).toBe(200);
    const validation = result?.body.validation as { valid: boolean; errors: string[] };
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual([
      "default_profile references unknown profile: missing",
    ]);
  });

  it("returns 400 invalid_config for malformed project schema", async () => {
    const dir = tempDir("ht-config-bad-toml-");
    mkdirSync(join(dir, ".harnesstap"), { recursive: true });
    writeFileSync(
      join(dir, ".harnesstap", "config.toml"),
      `schema = "not-a-project-schema"
version = 1
`,
      "utf-8",
    );
    const result = await inspect(configRequest(dir));
    expect(result?.status).toBe(400);
    expect(result?.body.error).toBe("invalid_config");
    expect(String(result?.body.message)).toContain("Unsupported project schema");
  });

  it("returns the existing file after POST /v1/bootstrap already_existed", async () => {
    const dir = tempDir("ht-config-bootstrap-");
    writeStarterProjectConfig({
      projectPath: dir,
      defaultProfile: "work",
      profileNames: ["work"],
    });
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    const boot = await fetch(`${server.url}/v1/bootstrap`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectPath: dir }),
    });
    expect(boot.status).toBe(200);
    const bootBody = (await boot.json()) as { already_existed?: boolean };
    expect(bootBody.already_existed).toBe(true);

    const result = await inspect(
      configRequest(dir, { token: server.token }),
      server.token,
    );
    expect(result?.status).toBe(200);
    expect((result?.body.config as { default_profile: string }).default_profile).toBe("work");
  });
});

