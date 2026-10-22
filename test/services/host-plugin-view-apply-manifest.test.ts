import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import { recordHostPluginViewWrite } from "../../src/services/package-cache/host-plugin-views.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hashOnDiskFile } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A git dependency ships only an Agent Plugins root plugin.json. The apply
// writes the Claude manifest (.claude-plugin/plugin.json) next to it. A refresh
// of the folder must leave that file to the apply, or every re-apply removes
// it, writes it again and makes a new backup.
let ctx: TestContext;
let canonical: string;
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-apply-manifest-");
  canonical = createTempDir("host-view-apply-manifest-canonical");
  writeTextFile(
    join(canonical, "plugin.json"),
    JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "gdep", version: "2.0.0" }),
  );
  writeTextFile(join(canonical, "skills/gskill/SKILL.md"), "# g\n");
});
afterEach(async () => {
  cleanupDir(canonical);
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/local/gdep/2.0.0";
const MANIFEST = `${VIEW}/.claude-plugin/plugin.json`;
const MANIFEST_BODY = '{\n  "name": "gdep",\n  "version": "2.0.0"\n}\n';

function mirror(): void {
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "local",
    pluginName: "gdep",
    version: "2.0.0",
    canonicalDir: canonical,
  });
}

// What the apply records when it writes a file into the folder.
function recordApplyWrote(path: string): void {
  const hash = hashOnDiskFile(join(ctx.homeDir, path)) ?? "";
  recordHostPluginViewWrite(join(ctx.homeDir, path), hash);
  const pin = createResource({ type: "plugin", name: "gdep", description: "", content: "{}", metadata: {}, source: "manual" });
  recordResourceMaterialization({
    resource_id: pin.id,
    scope: "global",
    root_path: ctx.homeDir,
    platform_id: "claude-code",
    path,
    action: "delete-file",
    ownership_key: "plugin:gdep@local",
    generated_hash: hash,
  });
}

function backupCount(): number {
  const path = join(getHarnesstapDir(), "cache/host-plugin-view-backups.json");
  if (!existsSync(path)) return 0;
  return Object.keys((JSON.parse(readFileSync(path, "utf8")) as { backups: object }).backups).length;
}

describe("refreshing a host plugin folder", () => {
  it("leaves the manifest the apply wrote in place, with no backup", () => {
    mirror();
    writeTextFile(join(ctx.homeDir, MANIFEST), MANIFEST_BODY);
    recordApplyWrote(MANIFEST);

    mirror();
    mirror();

    expect(readFileSync(join(ctx.homeDir, MANIFEST), "utf8")).toBe(MANIFEST_BODY);
    expect(backupCount()).toBe(0);
  });

  it("still removes a file the package dropped, with a backup", () => {
    writeTextFile(join(canonical, "skills/old/SKILL.md"), "# old\n");
    mirror();
    cleanupDir(join(canonical, "skills/old"));
    recordApplyWrote(`${VIEW}/skills/old/SKILL.md`);

    mirror();

    expect(existsSync(join(ctx.homeDir, VIEW, "skills/old"))).toBe(false);
    expect(backupCount()).toBe(1);
  });

  it("still keeps a manifest the user changed after the apply wrote it", () => {
    mirror();
    writeTextFile(join(ctx.homeDir, MANIFEST), MANIFEST_BODY);
    recordApplyWrote(MANIFEST);
    writeFileSync(join(ctx.homeDir, MANIFEST), '{"name":"mine"}\n');

    mirror();

    expect(readFileSync(join(ctx.homeDir, MANIFEST), "utf8")).toBe('{"name":"mine"}\n');
    expect(backupCount()).toBe(0);
  });
});
