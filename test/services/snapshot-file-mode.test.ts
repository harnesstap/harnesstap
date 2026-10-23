import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { recordApplyRemovalBackup, removalBackupTrashFile } from "../../src/models/apply-removal-backup.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { importPluginFromGitHubRef } from "../../src/services/plugin-git-import.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import { executeSafeFileRemovals } from "../../src/services/safe-file-removal.ts";
import { captureManagedSnapshotState } from "../../src/services/snapshot-capture.ts";
import { executeRevert, resolveRevertPlan } from "../../src/services/snapshot-revert.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

const ponytailLayoutFixture = join(
  import.meta.dirname,
  "../fixtures/plugin-import/git-origin-ponytail",
);

/** The permission bits of the file at the path. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o7777;
}

function write(context: TestContext, relativePath: string, content: string, mode?: number): string {
  const full = join(context.homeDir, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  if (mode !== undefined) chmodSync(full, mode);
  return full;
}

function ownByHarnessTap(context: TestContext, relativePath: string, content: string): void {
  const resource = createResource({
    type: "skill",
    name: relativePath.replace(/[^a-z0-9]/gi, "-"),
    description: "",
    content: "",
    metadata: {},
    source: "manual",
  });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "global",
    root_path: context.homeDir,
    platform_id: "claude-code",
    path: relativePath,
    action: "delete-file",
    ownership_key: `skill:${resource.name}`,
    generated_hash: hashGeneratedContent(content),
  });
}

function revert(snapshotId: string): void {
  const plan = resolveRevertPlan(snapshotId);
  if ("error" in plan) throw new Error(plan.error);
  expect(executeRevert(plan).warnings).toEqual([]);
}

const DIR = ".claude/plugins/cache/p";

describe("revert restores the file mode", () => {
  it("gives back the mode of files kept as trash references, and leaves links alone", async () => {
    const context = await createInitializedTestContext("snap-mode-trash-");
    try {
      const exec = `${DIR}/scripts/run.sh`;
      const secret = `${DIR}/secret.txt`;
      const plain = `${DIR}/plain.md`;
      const link = `${DIR}/latest.sh`;
      write(context, exec, "#!/bin/sh\necho hi\n", 0o755);
      write(context, secret, "s\n", 0o600);
      write(context, plain, "plain\n", 0o644);
      symlinkSync("scripts/run.sh", join(context.homeDir, link));
      for (const path of [exec, secret, plain]) ownByHarnessTap(context, path, readFileSync(join(context.homeDir, path), "utf-8"));
      const paths = [exec, secret, plain, link];
      const state = captureManagedSnapshotState({ rootPath: context.homeDir, generated: [], removalBackedPaths: paths });
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      executeSafeFileRemovals(context.homeDir, paths, { applyId: snapshot.id, snapshotId: snapshot.id });
      for (const path of paths) expect(existsSync(join(context.homeDir, path))).toBe(false);

      revert(snapshot.id);
      expect(modeOf(join(context.homeDir, exec))).toBe(0o755);
      expect(modeOf(join(context.homeDir, secret))).toBe(0o600);
      expect(modeOf(join(context.homeDir, plain))).toBe(0o644);
      expect(lstatSync(join(context.homeDir, link)).isSymbolicLink()).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("gives back the mode of a file the user edited (backup kept in the database)", async () => {
    const context = await createInitializedTestContext("snap-mode-edited-");
    try {
      const exec = `${DIR}/edited.sh`;
      write(context, exec, "#!/bin/sh\n", 0o755);
      ownByHarnessTap(context, exec, "#!/bin/sh\n");
      writeFileSync(join(context.homeDir, exec), "#!/bin/sh\necho mine\n");
      const state = captureManagedSnapshotState({ rootPath: context.homeDir, generated: [], removalBackedPaths: [exec] });
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      executeSafeFileRemovals(context.homeDir, [exec], { applyId: snapshot.id, snapshotId: snapshot.id, forceRemove: true });
      expect(existsSync(join(context.homeDir, exec))).toBe(false);

      revert(snapshot.id);
      expect(readFileSync(join(context.homeDir, exec), "utf-8")).toBe("#!/bin/sh\necho mine\n");
      expect(modeOf(join(context.homeDir, exec))).toBe(0o755);
    } finally {
      await context.cleanup();
    }
  });

  it("falls back to the trash file's mode for a legacy row without a mode", async () => {
    const context = await createInitializedTestContext("snap-mode-legacy-");
    try {
      const inTrash = `${DIR}/in-trash.sh`;
      const inRow = `${DIR}/in-row.sh`;
      const snapshot = createGlobalApplySnapshot({
        profile_name: "p",
        plugin_ids: [],
        state: { plugins: [], resources: [], platform_files: {}, trashed_files: [inTrash, inRow] },
      });
      for (const path of [inTrash, inRow]) {
        recordApplyRemovalBackup({
          apply_id: snapshot.id,
          snapshot_id: snapshot.id,
          relative_path: path,
          content: Buffer.from("#!/bin/sh\n"),
          mode: 0,
        });
      }
      // The first path has a trash file at 755; the second has none.
      const trashFile = removalBackupTrashFile(snapshot.id, inTrash);
      mkdirSync(join(trashFile, ".."), { recursive: true });
      writeFileSync(trashFile, "#!/bin/sh\n");
      chmodSync(trashFile, 0o755);

      revert(snapshot.id);
      expect(modeOf(join(context.homeDir, inTrash))).toBe(0o755);
      // Nothing records a mode for the second: the default applies.
      expect(readFileSync(join(context.homeDir, inRow), "utf-8")).toBe("#!/bin/sh\n");
      expect(modeOf(join(context.homeDir, inRow)) & 0o111).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("restores the mode of a file the snapshot captured from disk, text and binary", async () => {
    const context = await createInitializedTestContext("snap-mode-disk-");
    try {
      const text = `${DIR}/captured.sh`;
      const binary = `${DIR}/captured.bin`;
      const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0xff, 0xfe, 0x80]);
      write(context, text, "#!/bin/sh\n", 0o755);
      write(context, binary, "", 0o750);
      writeFileSync(join(context.homeDir, binary), bytes);
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [{ platformId: "claude-code", files: [{ path: text }] }],
        extraPaths: [binary],
      });
      expect(state.disk_modes).toEqual({ [text]: 0o755, [binary]: 0o750 });
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });

      for (const path of [text, binary]) {
        const full = join(context.homeDir, path);
        writeFileSync(full, "changed");
        chmodSync(full, 0o600);
        ownByHarnessTap(context, path, "changed");
      }
      revert(snapshot.id);
      expect(readFileSync(join(context.homeDir, text), "utf-8")).toBe("#!/bin/sh\n");
      expect(modeOf(join(context.homeDir, text))).toBe(0o755);
      expect(readFileSync(join(context.homeDir, binary)).equals(bytes)).toBe(true);
      expect(modeOf(join(context.homeDir, binary))).toBe(0o750);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps the live mode when an older snapshot recorded none", async () => {
    const context = await createInitializedTestContext("snap-mode-old-snapshot-");
    try {
      const path = `${DIR}/old.sh`;
      write(context, path, "#!/bin/sh\n", 0o755);
      const state = captureManagedSnapshotState({ rootPath: context.homeDir, generated: [], extraPaths: [path] });
      delete state.disk_modes;
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      writeFileSync(join(context.homeDir, path), "changed");
      ownByHarnessTap(context, path, "changed");
      revert(snapshot.id);
      expect(readFileSync(join(context.homeDir, path), "utf-8")).toBe("#!/bin/sh\n");
      expect(modeOf(join(context.homeDir, path))).toBe(0o755);
    } finally {
      await context.cleanup();
    }
  });
});

function modeTree(root: string): Map<string, number> {
  const modes = new Map<string, number>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && !name.endsWith(".json")) modes.set(relative(root, full), stat.mode & 0o7777);
    }
  };
  walk(root);
  return modes;
}

describe("use default then revert", () => {
  it("leaves every executable file executable", async () => {
    const context = await createInitializedTestContext("snap-mode-use-default-");
    try {
      await importPluginFromGitHubRef("DietrichGebert/ponytail", {
        refreshGit: async (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(ponytailLayoutFixture, opts.targetDir, { recursive: true });
          mkdirSync(join(opts.targetDir, "scripts"), { recursive: true });
          writeFileSync(join(opts.targetDir, "scripts/run.sh"), "#!/bin/sh\necho run\n");
          chmodSync(join(opts.targetDir, "scripts/run.sh"), 0o755);
          return { ok: true, sha: "abc123def456", message: "ok" };
        },
      });
      const work = createPlugin({ name: "work" });
      setPluginTags(work.id, ["profile"]);
      addDependency(work.id, "ponytail");
      const empty = createPlugin({ name: "default" });
      setPluginTags(empty.id, ["profile"]);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      const applied = await applyProfilePlugin("work", { harness: "claude-code", conflictPolicy: "replace" });
      expect(applied.cancelled).toBe(false);
      setActiveProfileName("work");
      const claudeRoot = join(context.homeDir, ".claude");
      const before = modeTree(claudeRoot);
      const executables = [...before].filter(([, mode]) => (mode & 0o111) !== 0).map(([path]) => path);
      expect(executables.length).toBeGreaterThanOrEqual(1);

      const backToDefault = await applyProfilePlugin("default", { harness: "claude-code", conflictPolicy: "replace" });
      const snapshotId = backToDefault.snapshot_id;
      if (!snapshotId) throw new Error("Expected a snapshot id from use default");
      for (const path of executables) expect(existsSync(join(claudeRoot, path))).toBe(false);

      revert(snapshotId);
      const after = modeTree(claudeRoot);
      for (const path of executables) expect(after.get(path)).toBe(before.get(path));
      expect([...after].filter(([path, mode]) => before.get(path) !== mode)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
