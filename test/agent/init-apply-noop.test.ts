import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/apply.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { bootstrapLocalLibrary } from "../../src/services/bootstrap-local-library.ts";
import { GLOBAL_DEFAULT_PROFILE_NAME } from "../../src/constants/profile.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";

const TOKEN = "test-token";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("sidecar-init-noop-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("sidecar HTTP: first apply after init is a no-op", () => {
  it("POST /v1/apply writes nothing onto a captured HOME", async () => {
    mkdirSync(join(ctx.homeDir, ".claude"), { recursive: true });
    mkdirSync(join(ctx.homeDir, ".cursor/skills/cursor-only-skill"), { recursive: true });
    writeFileSync(
      join(ctx.homeDir, ".claude/CLAUDE.md"),
      "# Global Claude instructions\nPrefer small diffs. CLAUDE-MD-MARKER\n",
    );
    writeFileSync(
      join(ctx.homeDir, ".cursor/skills/cursor-only-skill/SKILL.md"),
      "---\nname: cursor-only-skill\ndescription: Skill that only exists in Cursor\n---\nCursor specific guidance. CURSOR-ONLY-MARKER\n",
    );
    writeFileSync(
      join(ctx.homeDir, ".cursor/skills/cursor-only-skill/my-notes.md"),
      "my private notes\n",
    );

    await bootstrapLocalLibrary();
    setHarnessPreference({
      registered_harnesses: ["claude-code", "cursor"],
    });

    const response = await tryHandle(
      new Request("http://127.0.0.1/v1/apply", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          plugins: [GLOBAL_DEFAULT_PROFILE_NAME],
          scope: "home",
          onConflict: "replace",
        }),
      }),
      TOKEN,
      { isAgentSwitchInProgress: () => false },
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      written_files?: string[];
      skipped_files?: string[];
    };
    expect(body.written_files ?? []).toEqual([]);
    expect(readFileSync(join(ctx.homeDir, ".claude/CLAUDE.md"), "utf-8")).toContain(
      "CLAUDE-MD-MARKER",
    );
    expect(readFileSync(join(ctx.homeDir, ".claude/CLAUDE.md"), "utf-8")).not.toContain(
      "CODEX-AGENTS-MARKER",
    );
    expect(
      readFileSync(join(ctx.homeDir, ".cursor/skills/cursor-only-skill/my-notes.md"), "utf-8"),
    ).toBe("my private notes\n");
  });
});
