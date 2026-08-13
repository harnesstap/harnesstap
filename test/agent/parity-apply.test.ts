import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  resetAgentApplyInProgressForTests,
  setAgentApplyInProgressForTests,
  tryHandle,
} from "../../src/agent/parity-handlers/apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import {
  createImportedSnapshot,
  recordImportedSnapshotInstall,
} from "../../src/models/imported-snapshot.ts";
import { createResource } from "../../src/models/resource.ts";
import { getActiveProfileName } from "../../src/services/active-profile.ts";

const TOKEN = "test-token";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("parity-apply-");
  resetAgentApplyInProgressForTests();
});

afterEach(async () => {
  resetAgentApplyInProgressForTests();
  await ctx.cleanup();
});

function applyRequest(
  body: unknown,
  headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
  },
): Request {
  return new Request("http://127.0.0.1/v1/apply", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function handle(
  request: Request,
  deps: { isAgentSwitchInProgress: () => boolean } = {
    isAgentSwitchInProgress: () => false,
  },
): Promise<Response | null> {
  return tryHandle(request, TOKEN, deps);
}

describe("tryHandle POST /v1/apply", () => {
  it("returns null for other method+path pairs", async () => {
    const get = await handle(new Request("http://127.0.0.1/v1/apply"));
    expect(get).toBeNull();
    const health = await handle(new Request("http://127.0.0.1/v1/health", { method: "POST" }));
    expect(health).toBeNull();
  });

  it("requires bearer auth", async () => {
    const response = await handle(
      applyRequest({ plugins: ["demo"], scope: "home" }, { "content-type": "application/json" }),
    );
    expect(response?.status).toBe(401);
  });

  it("rejects invalid json", async () => {
    const response = await tryHandle(
      new Request("http://127.0.0.1/v1/apply", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: "{",
      }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects scope both", async () => {
    const response = await handle(applyRequest({ plugins: ["demo"], scope: "both" }));
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "invalid_scope" });
  });

  it("rejects home apply with more than one plugin", async () => {
    const response = await handle(
      applyRequest({ plugins: ["a", "b"], scope: "home" }),
    );
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_plugins");
    expect(body.message).toContain("exactly one plugin");
  });

  it("rejects empty plugins", async () => {
    const response = await handle(applyRequest({ plugins: [], scope: "home" }));
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "invalid_plugins" });
  });

  it("returns 404 plugin_not_found for unknown selectors", async () => {
    const response = await handle(
      applyRequest({ plugins: ["missing-plugin"], scope: "home" }),
    );
    expect(response?.status).toBe(404);
    expect(await response?.json()).toMatchObject({ error: "plugin_not_found" });
  });

  it("requires projectPath for project scope", async () => {
    createPlugin({ name: "tooling" });
    const response = await handle(
      applyRequest({ plugins: ["tooling"], scope: "project" }),
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "missing_project_path" });
  });

  it("returns 409 switch_in_progress when a switch is running", async () => {
    createPlugin({ name: "tooling" });
    const response = await handle(
      applyRequest({ plugins: ["tooling"], scope: "home" }),
      { isAgentSwitchInProgress: () => true },
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: "switch_in_progress" });
  });

  it("returns 409 apply_in_progress when another apply is running", async () => {
    setAgentApplyInProgressForTests(true);
    createPlugin({ name: "tooling" });
    const response = await handle(
      applyRequest({ plugins: ["tooling"], scope: "home" }),
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: "apply_in_progress" });
  });
});

function seedPluginWithInstruction(name: string, content = "# guide"): ReturnType<typeof createPlugin> {
  const plugin = createPlugin({ name });
  const resource = createResource({
    type: "instruction",
    name: "guide",
    description: "",
    content,
    metadata: {},
    source: "manual",
  });
  addResourceToPlugin(plugin.id, resource.id);
  return plugin;
}

function seedPluginWithSkill(name: string, skillName = "guide", content = "# guide"): ReturnType<typeof createPlugin> {
  const plugin = createPlugin({ name });
  const resource = createResource({
    type: "skill",
    name: skillName,
    description: `${skillName} skill`,
    content,
    metadata: {},
    source: "manual",
  });
  addResourceToPlugin(plugin.id, resource.id);
  return plugin;
}

describe("apply behavior", () => {
  it("home non-profile apply does not record an active profile", async () => {
    seedPluginWithInstruction("design-doc");

    const response = await handle(
      applyRequest({
        plugins: ["design-doc"],
        scope: "home",
        dryRun: false,
        harness: "claude-code",
      }),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { scope: string; cancelled: boolean };
    expect(body.scope).toBe("home");
    expect(body.cancelled).toBe(false);
    expect(getActiveProfileName()).toBeUndefined();
  });

  it("home profile apply records the active profile", async () => {
    const plugin = seedPluginWithInstruction("work");
    setPluginTags(plugin.id, ["profile"]);

    const response = await handle(
      applyRequest({
        plugins: ["work"],
        scope: "home",
        harness: "claude-code",
      }),
    );
    expect(response?.status).toBe(200);
    expect(getActiveProfileName()).toBe("work");
  });

  it("dryRun home writes nothing and sets dry_run", async () => {
    const plugin = seedPluginWithInstruction("work");
    setPluginTags(plugin.id, ["profile"]);

    const response = await handle(
      applyRequest({
        plugins: ["work"],
        scope: "home",
        dryRun: true,
        harness: "claude-code",
      }),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { dry_run: boolean; scope: string };
    expect(body.dry_run).toBe(true);
    expect(body.scope).toBe("home");
    expect(getActiveProfileName()).toBeUndefined();
  });

  it("project apply requires a real projectPath and returns project payload", async () => {
    seedPluginWithInstruction("tooling");

    const response = await handle(
      applyRequest({
        plugins: ["tooling"],
        scope: "project",
        projectPath: ctx.projectDir,
        dryRun: true,
        harness: "claude-code",
      }),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      scope: string;
      plugin: string;
      plugins: string[];
      platforms: Array<{ platform: string; files: Array<{ path: string }> }>;
    };
    expect(body.scope).toBe("project");
    expect(body.plugin).toBe("tooling");
    expect(body.plugins).toEqual(["tooling"]);
    expect(Array.isArray(body.platforms)).toBe(true);
  });

  it("onConflict skip does not require owned-overwrite confirmation", async () => {
    const plugin = seedPluginWithInstruction("work");
    setPluginTags(plugin.id, ["profile"]);

    const response = await handle(
      applyRequest({
        plugins: ["work"],
        scope: "home",
        onConflict: "skip",
        harness: "claude-code",
      }),
    );
    expect(response?.status).not.toBe(409);
    expect(response?.status).toBe(200);
  });

  it("home replace requires confirmOwnedOverwrite then succeeds", async () => {
    const plugin = seedPluginWithSkill("work", "guide", "# guide");
    setPluginTags(plugin.id, ["profile"]);

    const ownedPath = ".claude/skills/guide/SKILL.md";
    const snapshot = createImportedSnapshot({
      source_kind: "cursor-plugin",
      source_label: "fixtures/owner",
      plugin_name: "owner-plugin",
      resource_ids: [],
      metadata: {},
    });
    recordImportedSnapshotInstall({
      snapshot_id: snapshot.id,
      platform_id: "claude-code",
      files: [ownedPath],
    });
    mkdirSync(join(ctx.homeDir, ".claude/skills/guide"), { recursive: true });
    writeFileSync(join(ctx.homeDir, ownedPath), "hand-edited", "utf-8");

    const blocked = await handle(
      applyRequest({
        plugins: ["work"],
        scope: "home",
        harness: "claude-code",
      }),
    );
    expect(blocked?.status).toBe(409);
    expect(await blocked?.json()).toMatchObject({
      error: "owned_overwrite_confirmation_required",
    });

    const confirmed = await handle(
      applyRequest({
        plugins: ["work"],
        scope: "home",
        harness: "claude-code",
        confirmOwnedOverwrite: true,
      }),
    );
    expect(confirmed?.status).toBe(200);
  });
});
