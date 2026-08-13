import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/import.ts";
import { closeDb, getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createPlugin, getPluginResources } from "../../src/models/plugin-model.ts";
import { listResources } from "../../src/models/resource.ts";
import { PROFILE_PLUGIN_TAG } from "../../src/constants/profile.ts";
import { listImportedSnapshots } from "../../src/models/imported-snapshot.ts";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const claudeProject = join(fixturesRoot, "claude-project");
const skillPackage = join(fixturesRoot, "skill-packages", "mattpocock-minimal");
const TOKEN = "test-token";

const previousHome = process.env.HOME;
const previousHarnessTapHome = process.env.HARNESSTAP_HOME;
const tempDirs: string[] = [];

function withHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "ht-parity-import-"));
  tempDirs.push(dir);
  process.env.HOME = dir;
  process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
  closeDb();
  initializeSchema(getDb());
  return dir;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function request(
  path: string,
  body: unknown,
  token: string | null = TOKEN,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function handle(
  path: string,
  body: unknown,
  opts?: { token?: string | null; switching?: boolean },
): Promise<Response> {
  const result = await tryHandle(
    request(path, body, opts && "token" in opts ? opts.token : TOKEN),
    TOKEN,
    {
    isAgentSwitchInProgress: () => opts?.switching === true,
  });
  if (result === null) {
    throw new Error(`tryHandle returned null for ${path}`);
  }
  return result;
}

describe("parity import tryHandle", () => {
  beforeEach(() => {
    withHome();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    restoreEnv("HOME", previousHome);
    restoreEnv("HARNESSTAP_HOME", previousHarnessTapHome);
  });

  it("returns null for unrelated paths", async () => {
    const result = await tryHandle(
      new Request("http://127.0.0.1/v1/health"),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(result).toBeNull();
  });

  it("returns 401 without bearer auth", async () => {
    const response = await handle("/v1/import/preview", { kind: "scan", projectPath: claudeProject }, {
      token: null,
    });
    expect(response.status).toBe(401);
  });

  it("returns 400 invalid_body when kind is missing", async () => {
    const response = await handle("/v1/import/preview", { projectPath: claudeProject });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_body" });
  });

  it("returns 400 invalid_body when scan projectPath is missing", async () => {
    const response = await handle("/v1/import/preview", { kind: "scan" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_body" });
  });

  it("previews a project scan without inserting resources", async () => {
    const before = listResources().length;
    const response = await handle("/v1/import/preview", {
      kind: "scan",
      projectPath: claudeProject,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      kind: string;
      totalImports: number;
      warnings: string[];
      conflicts: unknown[];
      items: Array<{ type: string; name: string }>;
    };
    expect(body.kind).toBe("scan");
    expect(body.totalImports).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.totalImports);
    expect(body.items.some((item) => item.name.length > 0)).toBe(true);
    expect(listResources().length).toBe(before);
  });

  it("returns 200 with zero imports and a warning for an empty directory", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ht-empty-scan-"));
    tempDirs.push(empty);
    const response = await handle("/v1/import/preview", {
      kind: "scan",
      projectPath: empty,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      kind: string;
      totalImports: number;
      items: unknown[];
      conflicts: unknown[];
      warnings: string[];
    };
    expect(body.kind).toBe("scan");
    expect(body.totalImports).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.warnings.some((warning) => warning.includes("No harness resources"))).toBe(true);
  });

  it("commits a project scan and is idempotent with conflictPolicy skip", async () => {
    const first = await handle("/v1/import", {
      kind: "scan",
      projectPath: claudeProject,
      conflictPolicy: "skip",
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { kind: string; totalImports: number; resourceIds: string[] };
    expect(firstBody.kind).toBe("scan");
    expect(firstBody.totalImports).toBeGreaterThan(0);
    expect(firstBody.resourceIds.length).toBe(firstBody.totalImports);
    const count = listResources().length;
    expect(count).toBeGreaterThan(0);

    const second = await handle("/v1/import", {
      kind: "scan",
      projectPath: claudeProject,
      conflictPolicy: "skip",
    });
    expect(second.status).toBe(201);
    expect(listResources().length).toBe(count);
  });

  it("previews a local skill package and lists skills", async () => {
    const response = await handle("/v1/import/preview", {
      kind: "add",
      source: skillPackage,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      kind: string;
      totalImports: number;
      conflicts: unknown[];
      items: Array<{ name: string; category?: string }>;
      namespace: string;
    };
    expect(body.kind).toBe("add");
    expect(body.conflicts).toEqual([]);
    expect(body.totalImports).toBeGreaterThan(0);
    expect(body.items.some((item) => item.name === "caveman")).toBe(true);
    expect(body.namespace.length).toBeGreaterThan(0);
  });

  it("commits add into the library without installing to the home harness", async () => {
    const home = process.env.HOME as string;
    const response = await handle("/v1/import", {
      kind: "add",
      source: skillPackage,
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      kind: string;
      totalImports: number;
      resourceIds: string[];
      namespace: string;
      snapshotId: string;
    };
    expect(body.kind).toBe("add");
    expect(body.resourceIds.length).toBe(body.totalImports);
    expect(body.snapshotId.length).toBeGreaterThan(0);
    expect(listResources().some((resource) => resource.name === "caveman")).toBe(true);
    expect(listImportedSnapshots().length).toBeGreaterThan(0);
    const claudeHome = join(home, ".claude");
    expect(existsSync(claudeHome) ? readdirSync(claudeHome).length : 0).toBe(0);
  });

  it("previews from_project including pluginExists", async () => {
    createPlugin({ name: "team-defaults" });
    const response = await handle("/v1/import/preview", {
      kind: "from_project",
      projectPath: claudeProject,
      name: "team-defaults",
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { kind: string; pluginExists: boolean; totalImports: number };
    expect(body.kind).toBe("from_project");
    expect(body.pluginExists).toBe(true);
    expect(body.totalImports).toBeGreaterThan(0);
  });

  it("returns 409 plugin_exists when from_project skip hits an existing plugin", async () => {
    createPlugin({ name: "team-defaults" });
    const response = await handle("/v1/import", {
      kind: "from_project",
      projectPath: claudeProject,
      name: "team-defaults",
      conflictPolicy: "skip",
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "plugin_exists" });
  });

  it("overwrites an existing plugin with from_project", async () => {
    createPlugin({ name: "team-defaults" });
    const response = await handle("/v1/import", {
      kind: "from_project",
      projectPath: claudeProject,
      name: "team-defaults",
      conflictPolicy: "overwrite",
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      kind: string;
      plugin: { name: string; id: string };
      totalImports: number;
    };
    expect(body.kind).toBe("from_project");
    expect(body.plugin.name).toBe("team-defaults");
    expect(body.totalImports).toBeGreaterThan(0);
  });

  it("returns 400 when from_project name is missing", async () => {
    const response = await handle("/v1/import/preview", {
      kind: "from_project",
      projectPath: claudeProject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_body" });
  });

  it("returns 404 when attachProfile is unknown", async () => {
    const response = await handle("/v1/import", {
      kind: "scan",
      projectPath: claudeProject,
      attachProfile: "missing-profile",
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("attaches imported scan resources onto the selected profile plugin", async () => {
    const profile = createPlugin({ name: "engineering", tags: [PROFILE_PLUGIN_TAG] });
    const response = await handle("/v1/import", {
      kind: "scan",
      projectPath: claudeProject,
      attachProfile: "engineering",
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { attachedProfile: string; resourceIds: string[] };
    expect(body.attachedProfile).toBe("engineering");
    const attached = getPluginResources(profile.id);
    expect(attached.length).toBeGreaterThan(0);
    expect(attached.some((resource) => body.resourceIds.includes(resource.id))).toBe(true);
  });

  it("returns 409 switch_in_progress on commit but not on preview", async () => {
    const preview = await handle(
      "/v1/import/preview",
      { kind: "scan", projectPath: claudeProject },
      { switching: true },
    );
    expect(preview.status).toBe(200);

    const commit = await handle(
      "/v1/import",
      { kind: "scan", projectPath: claudeProject },
      { switching: true },
    );
    expect(commit.status).toBe(409);
    await expect(commit.json()).resolves.toMatchObject({ error: "switch_in_progress" });
  });
});
