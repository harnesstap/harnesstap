import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { tryHandle } from "../../src/agent/parity-handlers/environments.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import {
  setEnvironmentVarCommand,
  type EnvironmentShowPayload,
} from "../../src/services/environment-commands.ts";
import {
  getGlobalActiveEnvironmentName,
  setGlobalActiveEnvironment,
} from "../../src/services/environment-session.ts";

let ctx: TestContext;
const TOKEN = "test-token";
const idle = { isAgentSwitchInProgress: () => false };

function request(
  method: string,
  path: string,
  options?: { token?: string | null; body?: unknown },
): Request {
  const headers = new Headers();
  if (options?.token !== null) {
    headers.set("authorization", `Bearer ${options?.token ?? TOKEN}`);
  }
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function handle(
  method: string,
  path: string,
  options?: { token?: string | null; body?: unknown; switching?: boolean },
): Promise<Response | null> {
  return tryHandle(request(method, path, options), TOKEN, {
    isAgentSwitchInProgress: () => options?.switching === true,
  });
}

beforeEach(async () => {
  ctx = await createInitializedTestContext("parity-env-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("tryHandle environments", () => {
  it("returns null for unrelated paths", async () => {
    expect(await tryHandle(request("GET", "/v1/health"), TOKEN, idle)).toBeNull();
  });

  it("requires bearer auth on list", async () => {
    const response = await handle("GET", "/v1/environments/list", { token: null });
    expect(response?.status).toBe(401);
  });

  it("lists counts and is_global_active", async () => {
    const staging = createEnvironment({ name: "staging", description: "stg" });
    createEnvironment({ name: "prod", description: "prd" });
    setEnvironmentVarCommand(staging.id, "REGION", "us");
    setGlobalActiveEnvironment("staging");

    const response = await handle("GET", "/v1/environments/list");
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      environments: Array<{
        name: string;
        value_count: number;
        secret_ref_count: number;
        reference_count: number;
        is_global_active: boolean;
      }>;
    };
    const stagingRow = body.environments.find((row) => row.name === "staging");
    const prodRow = body.environments.find((row) => row.name === "prod");
    expect(stagingRow).toMatchObject({
      description: "stg",
      is_global_active: true,
    });
    expect(stagingRow!.value_count).toBeGreaterThanOrEqual(1);
    expect(prodRow?.is_global_active).toBe(false);
  });

  it("does not treat status as an environment name", async () => {
    const response = await handle("GET", "/v1/environments/status");
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      global_environment: string | null;
      has_drift: boolean;
      drift: unknown[];
    };
    expect(body).toHaveProperty("global_environment");
    expect(body).toHaveProperty("has_drift");
    expect(Array.isArray(body.drift)).toBe(true);
  });

  it("shows an environment and 404s unknown names", async () => {
    createEnvironment({ name: "staging", description: "stg" });
    const ok = await handle("GET", "/v1/environments/staging");
    expect(ok?.status).toBe(200);
    const shown = (await ok!.json()) as {
      environment: { name: string };
      values: { env_vars: Record<string, string> };
      secret_refs: Record<string, unknown>;
      references: { plugins: unknown[] };
    };
    expect(shown.environment.name).toBe("staging");
    expect(shown.values.env_vars).toEqual({});

    const missing = await handle("GET", "/v1/environments/nope");
    expect(missing?.status).toBe(404);
    await expect(missing!.json()).resolves.toMatchObject({ error: "not_found" });
  });
});

describe("POST /v1/environments", () => {
  it("creates a blank environment", async () => {
    const response = await handle("POST", "/v1/environments", {
      body: { name: "staging", description: "stg", mode: "blank" },
    });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      mode: string;
      environment: { environment: { name: string; description: string } };
      missing_keys: unknown[];
    };
    expect(body.mode).toBe("blank");
    expect(body.environment.environment.name).toBe("staging");
    expect(body.missing_keys).toEqual([]);
  });

  it("returns 409 for duplicate names", async () => {
    createEnvironment({ name: "staging" });
    const response = await handle("POST", "/v1/environments", {
      body: { name: "staging", mode: "blank" },
    });
    expect(response?.status).toBe(409);
    await expect(response!.json()).resolves.toMatchObject({
      error: "environment_exists",
    });
  });

  it("requires projectPath for from-project", async () => {
    const response = await handle("POST", "/v1/environments", {
      body: { name: "from-proj", mode: "from-project" },
    });
    expect(response?.status).toBe(400);
    await expect(response!.json()).resolves.toMatchObject({
      error: "projectPath_required",
    });
  });

  it("requires plugins for from-plugin", async () => {
    const response = await handle("POST", "/v1/environments", {
      body: { name: "from-plug", mode: "from-plugin", plugins: [] },
    });
    expect(response?.status).toBe(400);
    await expect(response!.json()).resolves.toMatchObject({
      error: "invalid_body",
    });
  });

  it("creates from-plugin and reports missing_keys without strict", async () => {
    const { createPlugin } = await import("../../src/models/plugin-model.ts");
    createPlugin({ name: "needs-region", needs: ["REGION"] });
    const response = await handle("POST", "/v1/environments", {
      body: {
        name: "plugin-env",
        mode: "from-plugin",
        plugins: ["needs-region"],
      },
    });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      mode: string;
      missing_keys: Array<{ key: string }>;
      environment: { environment: { name: string } };
    };
    expect(body.mode).toBe("from-plugin");
    expect(body.environment.environment.name).toBe("plugin-env");
    expect(body.missing_keys.some((row) => row.key === "REGION")).toBe(true);
  });

  it("creates from-project using the selected project path", async () => {
    setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });
    mkdirSync(join(ctx.projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(ctx.projectDir, ".claude", "settings.json"),
      JSON.stringify({ env: { CAPTURE_KEY: "scan-value" } }),
      "utf-8",
    );
    const { createPlugin, createPluginFromSources } = await import(
      "../../src/models/plugin-model.ts"
    );
    const { applyPluginToProject, createProject } = await import(
      "../../src/models/project.ts"
    );
    const plugin = createPlugin({
      name: "from-proj-plugin",
      needs: ["CAPTURE_KEY"],
    });
    const configured = createPluginFromSources({
      name: "from-proj-plugin",
      sourcePluginIds: [plugin.id],
    });
    const project = createProject({
      git_origin: "https://example.com/from-proj.git",
      name: "from-proj",
      local_path: ctx.projectDir,
    });
    applyPluginToProject({
      project_id: project.id,
      plugin_id: configured.id,
      platforms: ["claude-code"],
    });
    const response = await handle("POST", "/v1/environments", {
      body: {
        name: "from-proj",
        mode: "from-project",
        projectPath: ctx.projectDir,
      },
    });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      mode: string;
      environment?: { environment: { name: string } };
      persisted?: boolean;
    };
    expect(body.mode).toBe("from-project");
    if (body.persisted !== false) {
      expect(body.environment?.environment.name).toBe("from-proj");
    }
  });

  it("useAfterCreate sets the global active environment", async () => {
    const response = await handle("POST", "/v1/environments", {
      body: { name: "used", mode: "blank", useAfterCreate: true },
    });
    expect(response?.status).toBe(200);
    expect(getGlobalActiveEnvironmentName()).toBe("used");
  });

  it("rejects empty name", async () => {
    const response = await handle("POST", "/v1/environments", {
      body: { name: "  ", mode: "blank" },
    });
    expect(response?.status).toBe(400);
    await expect(response!.json()).resolves.toMatchObject({ error: "invalid_name" });
  });
});

describe("PUT /v1/environments/:name", () => {
  it("replaces collections and description", async () => {
    const env = createEnvironment({ name: "staging", description: "old" });
    setEnvironmentVarCommand(env.id, "DROP_ME", "1");

    const response = await handle("PUT", "/v1/environments/staging", {
      body: {
        description: "new",
        env_vars: { KEEP: "yes" },
        model_configs: [{ name: "default", model: "gpt-5", provider: "openai" }],
        permissions: [{ action: "allow", pattern: "Read(**)" }],
        secret_refs: { TOKEN: { provider: "env", ref: "TOKEN" } },
      },
    });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as EnvironmentShowPayload;
    expect(body.environment.description).toBe("new");
    expect(body.values.env_vars).toEqual({ KEEP: "yes" });
    expect(body.values.env_vars.DROP_ME).toBeUndefined();
    expect(body.values.model_configs[0]).toMatchObject({ model: "gpt-5" });
    expect(body.values.permissions[0]).toMatchObject({
      action: "allow",
      pattern: "Read(**)",
    });
    expect(body.secret_refs.TOKEN).toEqual({ provider: "env", ref: "TOKEN" });
  });

  it("rejects invalid secret provider and permission action", async () => {
    createEnvironment({ name: "staging" });
    const secret = await handle("PUT", "/v1/environments/staging", {
      body: { secret_refs: { K: { provider: "vault", ref: "x" } } },
    });
    expect(secret?.status).toBe(400);
    const perm = await handle("PUT", "/v1/environments/staging", {
      body: { permissions: [{ action: "maybe", pattern: "*" }] },
    });
    expect(perm?.status).toBe(400);
  });
});

describe("DELETE and use", () => {
  it("blocks referenced delete then succeeds with force", async () => {
    const { createPlugin, setPluginDefaultEnvironment } = await import(
      "../../src/models/plugin-model.ts"
    );
    const env = createEnvironment({ name: "staging" });
    const plugin = createPlugin({ name: "uses-staging" });
    setPluginDefaultEnvironment(plugin.id, env.id);

    const blocked = await handle("DELETE", "/v1/environments/staging");
    expect(blocked?.status).toBe(409);
    const blockedBody = (await blocked!.json()) as {
      error: string;
      references: { plugins: Array<{ name: string }> };
    };
    expect(blockedBody.error).toBe("environment_referenced");
    expect(blockedBody.references.plugins[0]?.name).toBe("uses-staging");

    const forced = await handle("DELETE", "/v1/environments/staging?force=true");
    expect(forced?.status).toBe(200);
    await expect(forced!.json()).resolves.toMatchObject({ deleted: true });
  });

  it("sets global use and rejects local", async () => {
    createEnvironment({ name: "staging" });
    const used = await handle("POST", "/v1/environments/staging/use", { body: {} });
    expect(used?.status).toBe(200);
    await expect(used!.json()).resolves.toMatchObject({
      environment_name: "staging",
      scope: "global",
    });
    expect(getGlobalActiveEnvironmentName()).toBe("staging");

    const local = await handle("POST", "/v1/environments/staging/use", {
      body: { local: true },
    });
    expect(local?.status).toBe(400);
    await expect(local!.json()).resolves.toMatchObject({ error: "invalid_body" });
  });

  it("mutating routes return 409 while a switch is in progress", async () => {
    createEnvironment({ name: "staging" });
    const create = await handle("POST", "/v1/environments", {
      body: { name: "other", mode: "blank" },
      switching: true,
    });
    expect(create?.status).toBe(409);
    const use = await handle("POST", "/v1/environments/staging/use", {
      body: {},
      switching: true,
    });
    expect(use?.status).toBe(409);
    const del = await handle("DELETE", "/v1/environments/staging", {
      switching: true,
    });
    expect(del?.status).toBe(409);
    const put = await handle("PUT", "/v1/environments/staging", {
      body: { env_vars: {} },
      switching: true,
    });
    expect(put?.status).toBe(409);
  });
});
