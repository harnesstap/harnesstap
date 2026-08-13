import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  profileDeleteRequestBody,
  profileDeleteSuccessMessage,
  shouldShowProfileDeleteControls,
} from "../../apps/desktop/src/lib/api/profile-delete.ts";
import { tryHandle } from "../../src/agent/parity-handlers/profile-delete.ts";
import { closeDb, getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createPlugin, getPlugin } from "../../src/models/plugin-model.ts";
import { getActiveProfileName, setActiveProfileName } from "../../src/services/active-profile.ts";

const TOKEN = "parity-delete-token";
const idle = { isAgentSwitchInProgress: () => false };

describe("tryHandle profile delete", () => {
  const previousHarnessTapHome = process.env.HARNESSTAP_HOME;
  const previousHome = process.env.HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    restoreEnv("HARNESSTAP_HOME", previousHarnessTapHome);
    restoreEnv("HOME", previousHome);
  });

  function withHome() {
    const dir = mkdtempSync(join(tmpdir(), "ht-parity-profile-delete-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    closeDb();
    initializeSchema(getDb());
    return dir;
  }

  function deleteRequest(
    name: string,
    init: { token?: string; body?: string | null; json?: unknown } = {},
  ): Request {
    const headers = new Headers();
    if (init.token !== null) {
      headers.set("authorization", `Bearer ${init.token ?? TOKEN}`);
    }
    let body: string | undefined;
    if (init.body !== undefined) {
      if (init.body !== null) {
        headers.set("content-type", "application/json");
        body = init.body;
      }
    } else if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    return new Request(
      `http://127.0.0.1/v1/profiles/${encodeURIComponent(name)}`,
      { method: "DELETE", headers, body },
    );
  }

  it("returns null for methods and paths it does not own", async () => {
    const get = new Request("http://127.0.0.1/v1/profiles/work");
    expect(await tryHandle(get, TOKEN, idle)).toBeNull();

    const attachments = new Request(
      "http://127.0.0.1/v1/profiles/work/attachments",
      { method: "DELETE" },
    );
    expect(await tryHandle(attachments, TOKEN, idle)).toBeNull();

    const health = new Request("http://127.0.0.1/v1/health", { method: "DELETE" });
    expect(await tryHandle(health, TOKEN, idle)).toBeNull();
  });

  it("returns 401 without a valid bearer", async () => {
    withHome();
    const response = await tryHandle(
      deleteRequest("work", { token: "nope" }),
      TOKEN,
      idle,
    );
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  it("returns 400 reserved_name for builtin empty", async () => {
    withHome();
    const response = await tryHandle(deleteRequest("empty"), TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "reserved_name" });
  });

  it("returns 404 not_found for an unknown name", async () => {
    withHome();
    const response = await tryHandle(deleteRequest("missing"), TOKEN, idle);
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("returns 400 not_a_profile for an untagged plugin", async () => {
    withHome();
    createPlugin({ name: "plain", tags: [] });
    const response = await tryHandle(deleteRequest("plain"), TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "not_a_profile" });
  });

  it("demotes only when the body is empty or deletePlugin is false", async () => {
    withHome();
    const plugin = createPlugin({ name: "work", tags: ["profile"] });

    const emptyBody = await tryHandle(deleteRequest("work"), TOKEN, idle);
    expect(emptyBody?.status).toBe(200);
    const demoted = (await emptyBody?.json()) as {
      plugin_id: string;
      plugin_name: string;
      tags: string[];
      was_active: boolean;
      plugin_deleted: boolean;
    };
    expect(demoted).toEqual({
      plugin_id: plugin.id,
      plugin_name: "work",
      tags: [],
      was_active: false,
      plugin_deleted: false,
    });
    expect(getPlugin(plugin.id)?.id).toBe(plugin.id);
    expect(getPlugin(plugin.id)?.tags.includes("profile")).toBe(false);
  });

  it("deletes the plugin row when deletePlugin is true", async () => {
    withHome();
    const plugin = createPlugin({ name: "work", tags: ["profile"] });
    const response = await tryHandle(
      deleteRequest("work", { json: { deletePlugin: true } }),
      TOKEN,
      idle,
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      plugin_id: plugin.id,
      plugin_name: "work",
      plugin_deleted: true,
    });
    expect(getPlugin(plugin.id)).toBeUndefined();
  });

  it("clears the active pointer without starting a switch", async () => {
    withHome();
    createPlugin({ name: "work", tags: ["profile"] });
    setActiveProfileName("work");

    const response = await tryHandle(deleteRequest("work"), TOKEN, idle);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      was_active: true,
      plugin_deleted: false,
    });
    expect(getActiveProfileName()).toBeUndefined();
    expect(idle.isAgentSwitchInProgress()).toBe(false);
  });

  it("accepts URL-encoded names", async () => {
    withHome();
    createPlugin({ name: "team/work", tags: ["profile"] });
    const response = await tryHandle(deleteRequest("team/work"), TOKEN, idle);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      plugin_name: "team/work",
      plugin_deleted: false,
    });
  });

  it("returns 409 switch_in_progress before mutating", async () => {
    withHome();
    createPlugin({ name: "work", tags: ["profile"] });
    const response = await tryHandle(deleteRequest("work"), TOKEN, {
      isAgentSwitchInProgress: () => true,
    });
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "switch_in_progress",
      message: "Another profile switch is already running",
    });
    expect(getPlugin("work")?.tags).toContain("profile");
  });

  it("returns 400 invalid_body for non-boolean deletePlugin", async () => {
    withHome();
    createPlugin({ name: "work", tags: ["profile"] });
    const response = await tryHandle(
      deleteRequest("work", { json: { deletePlugin: "yes" } }),
      TOKEN,
      idle,
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "invalid_body" });
    expect(getPlugin("work")?.tags).toContain("profile");
  });

  it("returns 400 invalid_body for malformed JSON", async () => {
    withHome();
    createPlugin({ name: "work", tags: ["profile"] });
    const response = await tryHandle(
      deleteRequest("work", { body: "{" }),
      TOKEN,
      idle,
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "invalid_body" });
  });
});

describe("profile delete desktop helpers", () => {
  it("builds demote-only and plugin-delete bodies", () => {
    expect(profileDeleteRequestBody(false)).toEqual({ deletePlugin: false });
    expect(profileDeleteRequestBody(true)).toEqual({ deletePlugin: true });
  });

  it("formats success toast copy", () => {
    expect(
      profileDeleteSuccessMessage({
        plugin_id: "1",
        plugin_name: "work",
        tags: [],
        was_active: false,
        plugin_deleted: false,
      }),
    ).toBe("Removed profile work");
    expect(
      profileDeleteSuccessMessage({
        plugin_id: "1",
        plugin_name: "work",
        tags: [],
        was_active: true,
        plugin_deleted: true,
      }),
    ).toBe("Removed profile work and deleted the plugin");
  });

  it("hides the footer while switching or disconnected", () => {
    expect(
      shouldShowProfileDeleteControls({
        disabled: true,
        baseUrl: "http://127.0.0.1",
        token: "t",
      }),
    ).toBe(false);
    expect(
      shouldShowProfileDeleteControls({
        disabled: false,
        baseUrl: null,
        token: "t",
      }),
    ).toBe(false);
    expect(
      shouldShowProfileDeleteControls({
        disabled: false,
        baseUrl: "http://127.0.0.1",
        token: null,
      }),
    ).toBe(false);
    expect(
      shouldShowProfileDeleteControls({
        disabled: false,
        baseUrl: "http://127.0.0.1",
        token: "t",
      }),
    ).toBe(true);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
