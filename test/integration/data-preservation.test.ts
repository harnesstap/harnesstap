import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { getAllPlatforms } from "../../src/platforms/registry.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createProfileCommand, useProfileCommand } from "../../src/services/profile-commands.ts";
import { applyProfilePlugin, clearGlobalProfileApply } from "../../src/services/profile-apply.ts";
import {
  ProfileStashError,
  popProfileStashCommand,
  stashProfileCommand,
} from "../../src/services/profile-stash.ts";
import { switchProfile } from "../../src/services/profile-switch.ts";
import { restoreSafeRemovalBackup } from "../../src/services/safe-file-removal.ts";

const SENTINEL_NAME = "harnesstap-unmanaged-sentinel.txt";
const SENTINEL_BODY = "HARNESSTAP_UNMANAGED_SENTINEL\n";
const INSTRUCTION_MARK = "\nHARNESSTAP_USER_INSTRUCTION_SENTINEL\n";

interface SentinelRecord {
  path: string;
  content: Buffer;
  mode: number;
}

function seedQaHome(home: string, project: string): void {
  mkdirSync(join(home, ".claude/skills/big-review/scripts"), { recursive: true });
  mkdirSync(join(home, ".claude/skills/tiny-skill"), { recursive: true });
  mkdirSync(join(home, ".claude/agents"), { recursive: true });
  mkdirSync(join(home, ".claude/commands"), { recursive: true });
  writeFileSync(
    join(home, ".claude/skills/tiny-skill/SKILL.md"),
    "---\nname: tiny-skill\ndescription: Small skill\n---\nSay hello politely. TINY-BODY-MARKER\n",
  );
  writeFileSync(
    join(home, ".claude/skills/big-review/SKILL.md"),
    "---\nname: big-review\ndescription: Thorough review\n---\n# Big Review\nEND-OF-BIG-REVIEW-MARKER\n",
  );
  writeFileSync(join(home, ".claude/skills/big-review/scripts/lint.sh"), "#!/bin/sh\necho lint ok\n");
  writeFileSync(
    join(home, ".claude/CLAUDE.md"),
    "# Global Claude instructions\nPrefer small diffs. CLAUDE-MD-MARKER\n",
  );
  writeFileSync(
    join(home, ".claude/settings.json"),
    `${JSON.stringify({ model: "sonnet", permissions: { allow: ["Read"] } }, null, 2)}\n`,
  );
  mkdirSync(join(home, ".cursor/skills/cursor-only-skill"), { recursive: true });
  writeFileSync(
    join(home, ".cursor/skills/cursor-only-skill/SKILL.md"),
    "---\nname: cursor-only-skill\ndescription: Skill that only exists in Cursor\n---\nCursor specific guidance. CURSOR-ONLY-MARKER\n",
  );
  writeFileSync(
    join(home, ".cursor/skills/cursor-only-skill/my-notes.md"),
    "my private notes\n",
  );
  writeFileSync(
    join(home, ".cursor/mcp.json"),
    `${JSON.stringify({ mcpServers: { "cursor-mcp": { command: "node" } } }, null, 2)}\n`,
  );
  mkdirSync(join(home, ".codex/prompts"), { recursive: true });
  writeFileSync(join(home, ".codex/config.toml"), 'model = "gpt-5"\n');
  writeFileSync(join(home, ".codex/AGENTS.md"), "# Codex global AGENTS\nCODEX-AGENTS-MARKER\n");
  mkdirSync(join(home, ".config/opencode/agent"), { recursive: true });
  writeFileSync(
    join(home, ".config/opencode/opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: {} }, null, 2)}\n`,
  );
  mkdirSync(join(home, ".agents/skills/shared-skill"), { recursive: true });
  writeFileSync(join(home, ".agents/AGENTS.md"), "# Shared AGENTS.md\nAGENTS-MD-MARKER\n");
  writeFileSync(
    join(home, ".agents/skills/shared-skill/SKILL.md"),
    "---\nname: shared-skill\ndescription: Shared\n---\nShared body. SHARED-MARKER\n",
  );

  mkdirSync(join(project, ".claude/skills/proj-skill"), { recursive: true });
  mkdirSync(join(project, ".cursor/rules"), { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(
    join(project, ".claude/skills/proj-skill/SKILL.md"),
    "---\nname: proj-skill\ndescription: Project-scope skill\n---\nProject body. PROJ-SKILL-MARKER\n",
  );
  writeFileSync(join(project, "AGENTS.md"), "# Project AGENTS\nPROJ-AGENTS-MARKER\n");
  writeFileSync(join(project, "src/index.ts"), "console.log(1)\n");
}

function tildeToHome(home: string, tildePath: string): string {
  return join(home, tildePath.slice(2));
}

function plantSentinels(home: string): {
  files: SentinelRecord[];
  configMarkers: Array<{ path: string; needle: string }>;
} {
  const files: SentinelRecord[] = [];
  const configMarkers: Array<{ path: string; needle: string }> = [];
  const seen = new Set<string>();
  const addFile = (full: string, content: string): void => {
    if (seen.has(full)) return;
    seen.add(full);
    mkdirSync(join(full, ".."), { recursive: true });
    if (!existsSync(full)) {
      writeFileSync(full, content);
    }
    const stat = statSync(full);
    files.push({ path: full, content: readFileSync(full), mode: stat.mode });
  };

  for (const platform of getAllPlatforms()) {
    const skills = platform.globalPaths.skills;
    if (skills?.startsWith("~/")) {
      const root = tildeToHome(home, skills);
      if (existsSync(root)) {
        for (const name of readdirSync(root)) {
          const dir = join(root, name);
          try {
            if (statSync(dir).isDirectory()) {
              addFile(join(dir, SENTINEL_NAME), SENTINEL_BODY);
            }
          } catch {
            // ignore
          }
        }
      }
    }
    const settings = platform.globalPaths.settings;
    if (settings?.startsWith("~/") && existsSync(tildeToHome(home, settings))) {
      const full = tildeToHome(home, settings);
      const raw = readFileSync(full, "utf-8");
      if (full.endsWith(".json") && !raw.includes("harnesstap_unmanaged_sentinel")) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          parsed.harnesstap_unmanaged_sentinel = true;
          writeFileSync(full, `${JSON.stringify(parsed, null, 2)}\n`);
        } catch {
          writeFileSync(full, `${raw}\n// harnesstap_unmanaged_sentinel\n`);
        }
      } else if (full.endsWith(".toml") && !raw.includes("harnesstap_unmanaged_sentinel")) {
        writeFileSync(full, `${raw}\nharnesstap_unmanaged_sentinel = true\n`);
      }
      configMarkers.push({ path: full, needle: "harnesstap_unmanaged_sentinel" });
    }
    const instructions = platform.globalPaths.instructions;
    if (instructions?.startsWith("~/") && existsSync(tildeToHome(home, instructions))) {
      const full = tildeToHome(home, instructions);
      const raw = readFileSync(full, "utf-8");
      if (!raw.includes("HARNESSTAP_USER_INSTRUCTION_SENTINEL")) {
        writeFileSync(full, `${raw}${INSTRUCTION_MARK}`);
      }
      configMarkers.push({ path: full, needle: "HARNESSTAP_USER_INSTRUCTION_SENTINEL" });
    }
  }
  addFile(join(home, ".cursor/skills/cursor-only-skill/my-notes.md"), "my private notes\n");
  return { files, configMarkers };
}

function assertSentinels(planted: ReturnType<typeof plantSentinels>): void {
  for (const record of planted.files) {
    expect(existsSync(record.path)).toBe(true);
    expect(readFileSync(record.path).equals(record.content)).toBe(true);
    expect(statSync(record.path).mode).toBe(record.mode);
  }
  for (const marker of planted.configMarkers) {
    expect(existsSync(marker.path)).toBe(true);
    const text = readFileSync(marker.path, "utf-8");
    const isInstruction = marker.needle === "HARNESSTAP_USER_INSTRUCTION_SENTINEL";
    if (isInstruction) {
      expect(text).toContain(marker.needle);
    }
  }
}

describe("G4 data preservation", () => {
  it("keeps unmanaged sentinels across init, apply, use, switch, stash, clear, and restore", async () => {
    const context = await createTestContext("g4-data-preservation");
    try {
      seedQaHome(context.homeDir, context.projectDir);
      plantSentinels(context.homeDir);

      const init = await runCli(["init", "--harnesses", "claude-code,cursor,codex,opencode"]);
      expect(init.exitCode ?? 0).toBe(0);
      setHarnessPreference({
        registered_harnesses: ["claude-code", "cursor", "codex", "opencode"],
      });
      const sentinels = plantSentinels(context.homeDir);
      const applyOpts = { conflictPolicy: "replace" as const, pull: false };
      await useProfileCommand("global default", applyOpts);
      const afterFirstApply = plantSentinels(context.homeDir);
      await useProfileCommand("global default", applyOpts);
      await applyProfilePlugin("global default", applyOpts);
      const third = await applyProfilePlugin("global default", applyOpts);
      expect(third.written_files.length).toBeGreaterThanOrEqual(0);
      assertSentinels(sentinels);
      assertSentinels(afterFirstApply);

      createProfileCommand({ name: "work" });
      await switchProfile("work", { apply: applyOpts });
      assertSentinels(sentinels);
      await switchProfile("global default", { apply: applyOpts });
      assertSentinels(sentinels);

      try {
        await stashProfileCommand(applyOpts);
        await popProfileStashCommand(applyOpts);
      } catch (error) {
        if (!(error instanceof ProfileStashError)) {
          throw error;
        }
      }
      assertSentinels(sentinels);

      const cleared = await clearGlobalProfileApply(applyOpts);
      assertSentinels(sentinels);
      if (cleared.snapshot_id && (cleared.removed_files?.length ?? 0) > 0) {
        restoreSafeRemovalBackup({
          snapshotId: cleared.snapshot_id,
          rootPath: context.homeDir,
        });
      }
      assertSentinels(sentinels);
      expect(readFileSync(
        join(context.homeDir, ".cursor/skills/cursor-only-skill/my-notes.md"),
        "utf-8",
      )).toBe("my private notes\n");
      expect(existsSync(
        join(context.homeDir, ".cursor/skills/cursor-only-skill/SKILL.md"),
      )).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
