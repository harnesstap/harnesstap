import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  buildHooksJson,
  scanHooksFile,
} from "../../src/services/hook-serialization.ts";
import type { HookMetadata } from "../../src/types.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

describe("hook-serialization", () => {
  it("round-trips nested PostToolUse matcher hooks from Claude settings", () => {
    const settingsPath = join(fixture, ".claude/settings.json");
    const scanned = scanHooksFile(settingsPath, ".claude/settings.json");
    expect(scanned).toHaveLength(1);

    const meta = scanned[0]?.metadata as HookMetadata;
    expect(meta.event).toBe("PostToolUse");
    expect(meta.matcher).toBe("Edit|Write");
    expect(meta.script).toContain("hook.mjs");
    expect(meta.hook_entry?.type).toBe("command");

    const rebuilt = buildHooksJson(
      scanned.map((resource) => resource.metadata as HookMetadata),
    );
    expect(rebuilt.hooks.PostToolUse).toEqual([
      {
        matcher: "Edit|Write",
        hooks: [
          {
            type: "command",
            command: 'node ".claude/skills/impeccable/scripts/hook.mjs"',
            timeout: 5,
            statusMessage: "Checking UI changes",
          },
        ],
      },
    ]);
  });

  it("round-trips versioned Cursor hooks.json", () => {
    const hooksPath = join(fixture, ".cursor/hooks.json");
    const scanned = scanHooksFile(hooksPath, ".cursor/hooks.json");
    expect(scanned).toHaveLength(1);

    const rebuilt = buildHooksJson(
      scanned.map((resource) => resource.metadata as HookMetadata),
      { version: 1 },
    );
    expect(rebuilt.version).toBe(1);
    expect(rebuilt.hooks.preToolUse).toEqual([
      {
        command: 'node ".cursor/skills/impeccable/scripts/hook-before-edit.mjs"',
        timeout: 5,
      },
    ]);
  });

  it("round-trips Codex hooks without version wrapper", () => {
    const hooksPath = join(fixture, ".codex/hooks.json");
    const scanned = scanHooksFile(hooksPath, ".codex/hooks.json");
    const rebuilt = buildHooksJson(
      scanned.map((resource) => resource.metadata as HookMetadata),
    );

    expect(rebuilt.version).toBeUndefined();
    expect(rebuilt.hooks.PostToolUse?.[0]).toEqual({
      matcher: "Edit|Write",
      hooks: [
        expect.objectContaining({
          command: expect.stringContaining("hook.mjs"),
          timeout: 5,
        }),
      ],
    });
  });
});
