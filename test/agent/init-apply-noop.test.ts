import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle as tryHandleApply } from "../../src/agent/parity-handlers/apply.ts";
import { handleProfileApplyPreview } from "../../src/agent/profile-apply-preview-handlers.ts";
import { tryHandle as tryHandleProfileDelete } from "../../src/agent/parity-handlers/profile-delete.ts";
import { tryHandle as tryHandleResourceMutate } from "../../src/agent/parity-handlers/resource-mutate.ts";
import { GLOBAL_DEFAULT_PROFILE_NAME } from "../../src/constants/profile.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { listResources } from "../../src/models/resource.ts";
import { bootstrapLocalLibrary } from "../../src/services/bootstrap-local-library.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";
import { switchProfile } from "../../src/services/profile-switch.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const IDLE = { isAgentSwitchInProgress: () => false };
const NOTES = "my private notes\n";
const CLAUDE = "# Global Claude instructions\nPrefer small diffs. CLAUDE-MD-MARKER\n";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("sidecar-init-noop-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function authJsonRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function seedCapturedHome(homeDir: string): void {
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  mkdirSync(join(homeDir, ".cursor/skills/cursor-only-skill"), { recursive: true });
  writeFileSync(join(homeDir, ".claude/CLAUDE.md"), CLAUDE);
  writeFileSync(
    join(homeDir, ".cursor/skills/cursor-only-skill/SKILL.md"),
    "---\nname: cursor-only-skill\ndescription: Skill that only exists in Cursor\n---\nCursor specific guidance. CURSOR-ONLY-MARKER\n",
  );
  writeFileSync(join(homeDir, ".cursor/skills/cursor-only-skill/my-notes.md"), NOTES);
}

function assertCapturedHomeUntouched(homeDir: string): void {
  expect(readFileSync(join(homeDir, ".claude/CLAUDE.md"), "utf-8")).toBe(CLAUDE);
  expect(readFileSync(join(homeDir, ".claude/CLAUDE.md"), "utf-8")).not.toContain(
    "CODEX-AGENTS-MARKER",
  );
  expect(readFileSync(join(homeDir, ".cursor/skills/cursor-only-skill/my-notes.md"), "utf-8")).toBe(
    NOTES,
  );
}

describe("sidecar HTTP: first apply after init is a no-op", () => {
  it("POST /v1/apply writes nothing onto a captured HOME", async () => {
    seedCapturedHome(ctx.homeDir);
    await bootstrapLocalLibrary();
    setHarnessPreference({
      registered_harnesses: ["claude-code", "cursor"],
    });

    const response = await tryHandleApply(
      authJsonRequest("/v1/apply", "POST", {
        plugins: [GLOBAL_DEFAULT_PROFILE_NAME],
        scope: "home",
        onConflict: "replace",
      }),
      TOKEN,
      IDLE,
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      written_files?: string[];
    };
    expect(body.written_files ?? []).toEqual([]);
    assertCapturedHomeUntouched(ctx.homeDir);
  });

  it("keeps unmanaged files through overwrite apply, switch, resource delete, and profile delete", async () => {
    seedCapturedHome(ctx.homeDir);
    await bootstrapLocalLibrary();
    setHarnessPreference({
      registered_harnesses: ["claude-code", "cursor"],
    });

    const overwrite = await tryHandleApply(
      authJsonRequest("/v1/apply", "POST", {
        plugins: [GLOBAL_DEFAULT_PROFILE_NAME],
        scope: "home",
        onConflict: "replace",
        confirmOwnedOverwrite: true,
      }),
      TOKEN,
      IDLE,
    );
    expect(overwrite?.status).toBe(200);
    const overwriteBody = (await overwrite?.json()) as { written_files?: string[] };
    expect(
      (overwriteBody.written_files ?? []).some(
        (path) => path.endsWith("CLAUDE.md") || path.endsWith("SKILL.md") || path.endsWith(".mdc"),
      ),
    ).toBe(false);
    assertCapturedHomeUntouched(ctx.homeDir);

    createProfileCommand({ name: "work" });
    const preview = await handleProfileApplyPreview(
      authJsonRequest("/v1/profiles/apply-preview", "POST", {
        profile: "work",
        scope: "home",
      }),
      TOKEN,
    );
    expect(preview?.status).toBe(200);
    const previewBody = (await preview?.json()) as {
      removals?: {
        owned_unmodified: string[];
        owned_modified: string[];
        unmanaged: string[];
      };
    };
    expect(previewBody.removals).toBeDefined();
    expect(Array.isArray(previewBody.removals?.owned_unmodified)).toBe(true);
    expect(Array.isArray(previewBody.removals?.owned_modified)).toBe(true);
    expect(Array.isArray(previewBody.removals?.unmanaged)).toBe(true);
    await switchProfile("work", { apply: { conflictPolicy: "replace", pull: false } });
    assertCapturedHomeUntouched(ctx.homeDir);
    await switchProfile(GLOBAL_DEFAULT_PROFILE_NAME, {
      apply: { conflictPolicy: "replace", pull: false },
    });
    assertCapturedHomeUntouched(ctx.homeDir);

    const skill = listResources({ type: "skill" }).find((resource) =>
      resource.name.includes("cursor-only-skill"),
    );
    expect(skill).toBeDefined();
    const deleted = await tryHandleResourceMutate(
      authJsonRequest(
        `/v1/library/resources/${encodeURIComponent(skill?.id ?? "")}`,
        "DELETE",
        { mode: "library" },
      ),
      TOKEN,
      IDLE,
    );
    expect(deleted?.status).toBe(200);
    assertCapturedHomeUntouched(ctx.homeDir);

    const removed = await tryHandleProfileDelete(
      authJsonRequest("/v1/profiles/work", "DELETE", { deletePlugin: true }),
      TOKEN,
      IDLE,
    );
    expect(removed?.status).toBe(200);
    assertCapturedHomeUntouched(ctx.homeDir);
  });
});
