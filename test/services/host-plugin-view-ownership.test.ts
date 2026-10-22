import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { materializeFiles } from "../../src/services/applier.ts";
import {
  isInHostPluginViewCreatedByHarnessTap,
  mirrorHostPluginView,
} from "../../src/services/package-cache/host-plugin.ts";
import { isPreexistingPath } from "../../src/models/preexisting-path.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { executeSafeFileRemovals, hashOnDiskFile } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// An install copies a marketplace plugin into ~/.claude/plugins/cache before
// the apply runs. The apply emits the same bytes and writes nothing, so those
// files must still count as HarnessTap's, not as files the user had.
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-own-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";
const SKILL = `${VIEW}/skills/dup-skill/SKILL.md`;
const SKILL_BODY = "---\nname: dup-skill\ndescription: Dup\n---\n# dup\n";

function mirrorDup(): void {
  const canonical = createTempDir("host-view-canonical");
  writeTextFile(join(canonical, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "1.0.0" }));
  writeTextFile(join(canonical, "skills/dup-skill/SKILL.md"), SKILL_BODY);
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "mkta",
    pluginName: "dup",
    version: "1.0.0",
    canonicalDir: canonical,
  });
  cleanupDir(canonical);
}

describe("host plugin folders a HarnessTap install created", () => {
  it("are adopted by the apply instead of recorded as the user's", async () => {
    mirrorDup();
    // A folder Claude installed itself stays the user's.
    const claudeOwn = ".claude/plugins/cache/other/own/1.0.0/notes.md";
    writeTextFile(join(ctx.homeDir, claudeOwn), "mine\n");

    const result = await materializeFiles(
      [
        { path: SKILL, content: SKILL_BODY },
        { path: claudeOwn, content: "mine\n" },
      ],
      ctx.homeDir,
      { conflictPolicy: "skip" },
    );

    expect(result.adoptedFiles).toEqual([SKILL]);
    expect(isPreexistingPath(ctx.homeDir, SKILL)).toBe(false);
    expect(isPreexistingPath(ctx.homeDir, claudeOwn)).toBe(true);
    expect(isInHostPluginViewCreatedByHarnessTap(join(ctx.homeDir, claudeOwn))).toBe(false);
  });

  it("are removed with their empty folders once HarnessTap owns them, and then forgotten", () => {
    mirrorDup();
    const pin = createResource({ type: "plugin", name: "dup", description: "", content: "{}", metadata: {}, source: "manual" });
    for (const path of [SKILL, `${VIEW}/.claude-plugin/plugin.json`]) {
      recordResourceMaterialization({
        resource_id: pin.id,
        scope: "global",
        root_path: ctx.homeDir,
        platform_id: "claude-code",
        path,
        action: "delete-file",
        ownership_key: "plugin:dup@mkta",
        generated_hash: hashOnDiskFile(join(ctx.homeDir, path)) ?? "",
      });
    }
    const removal = executeSafeFileRemovals(ctx.homeDir, [SKILL, `${VIEW}/.claude-plugin/plugin.json`]);

    expect(removal.skipped).toEqual([]);
    expect(existsSync(join(ctx.homeDir, ".claude/plugins/cache/mkta"))).toBe(false);
    expect(existsSync(join(removal.backupDir, ...SKILL.split("/")))).toBe(true);
    expect(readFileSync(join(ctx.homeDir, ".harnesstap/cache/host-plugin-views.json"), "utf8").trim()).toBe("[]");
  });
});
