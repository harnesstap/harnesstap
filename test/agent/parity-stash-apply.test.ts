import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/stash-apply.ts";
import { createAgentFetchHandler, createDefaultAgentRouteDeps } from "../../src/agent/routes.ts";
import { writeAgentTokenFile } from "../../src/agent/token.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";

describe("POST /v1/profiles/stash/apply", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withHome() {
    const dir = mkdtempSync(join(tmpdir(), "ht-parity-stash-apply-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    initializeSchema(getDb());
    const token = "test-token";
    writeAgentTokenFile(join(dir, ".harnesstap"), token);
    return { token, homeDir: dir };
  }

  async function seedUntrackedStash(homeDir: string): Promise<void> {
    const profile = createPlugin({ name: "work" });
    setPluginTags(profile.id, ["profile"]);
    addResourceToPlugin(
      profile.id,
      createResource({
        type: "skill",
        name: "demo",
        description: "demo",
        content: "# Demo",
        metadata: {},
        source: "manual",
      }).id,
    );
    await applyProfilePlugin("work", {
      harness: "claude-code",
      conflictPolicy: "replace",
    });
    setActiveProfileName("work");
    mkdirSync(join(homeDir, ".claude/skills/manual-skill"), { recursive: true });
    writeFileSync(
      join(homeDir, ".claude/skills/manual-skill/SKILL.md"),
      "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      "utf-8",
    );
  }

  function applyRequest(token: string | null, body: string | undefined = "{}"): Request {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    return new Request("http://127.0.0.1/v1/profiles/stash/apply", {
      method: "POST",
      headers,
      body,
    });
  }

  it("returns null for unrelated method+path", async () => {
    const result = await tryHandle(
      new Request("http://127.0.0.1/v1/profiles/stash/pop", { method: "POST" }),
      "test-token",
      { isAgentSwitchInProgress: () => false },
    );
    expect(result).toBeNull();
  });

  it("returns 401 without bearer auth", async () => {
    withHome();
    const response = await tryHandle(applyRequest(null), "test-token", {
      isAgentSwitchInProgress: () => false,
    });
    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
  });

  it("returns 409 switch_in_progress when a switch is running", async () => {
    const { token } = withHome();
    const response = await tryHandle(applyRequest(token), token, {
      isAgentSwitchInProgress: () => true,
    });
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "switch_in_progress",
      message: "Another profile switch is already running",
    });
  });

  it("returns 400 stash_failed when the stash is empty", async () => {
    const { token } = withHome();
    const response = await tryHandle(applyRequest(token), token, {
      isAgentSwitchInProgress: () => false,
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "stash_failed",
      message: "No stashed profile to restore.",
    });
  });

  it("returns 400 invalid_json for a non-JSON body", async () => {
    const { token } = withHome();
    const response = await tryHandle(applyRequest(token, "not-json"), token, {
      isAgentSwitchInProgress: () => false,
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("applies stash@{0}, keeps the entry, then pop empties the list", async () => {
    const { token, homeDir } = withHome();
    await seedUntrackedStash(homeDir);
    const fetch = createAgentFetchHandler(token, 7474);
    const auth = { authorization: `Bearer ${token}` };

    const stashed = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ harness: "claude-code" }),
      }),
    );
    expect(stashed.status).toBe(200);
    expect(existsSync(join(homeDir, ".claude/skills/manual-skill/SKILL.md"))).toBe(false);

    const applied = await tryHandle(
      applyRequest(token, JSON.stringify({ harness: "claude-code" })),
      token,
      { isAgentSwitchInProgress: () => false },
    );
    expect(applied?.status).toBe(200);
    const applyBody = (await applied?.json()) as {
      removed: boolean;
      restored: { restored_files: string[]; cancelled: boolean };
      entry: { profile_name: string; contents: { resources: Array<{ name: string }> } };
    };
    expect(applyBody.removed).toBe(false);
    expect(applyBody.restored.cancelled).toBe(false);
    expect(applyBody.entry.profile_name).toBe("work");
    expect(existsSync(join(homeDir, ".claude/skills/manual-skill/SKILL.md"))).toBe(true);

    const listed = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash", { headers: auth }),
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { entries: unknown[] };
    expect(listBody.entries).toHaveLength(1);

    const popped = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash/pop", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(popped.status).toBe(200);
    const popBody = (await popped.json()) as { removed: boolean };
    expect(popBody.removed).toBe(true);

    const empty = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash", { headers: auth }),
    );
    const emptyBody = (await empty.json()) as { entries: unknown[] };
    expect(emptyBody.entries).toHaveLength(0);
  });

  it("is reachable through tryParityRoutes once coordination is landed", async () => {
    const { token } = withHome();
    const fetch = createAgentFetchHandler(token, 7474, {
      ...createDefaultAgentRouteDeps(),
      isAgentSwitchInProgress: () => true,
    });
    const response = await fetch(applyRequest(token));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "switch_in_progress",
      message: "Another profile switch is already running",
    });
  });
});
