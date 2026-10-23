import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createGlobalApplySnapshot, getGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { recordApplyRemovalBackup } from "../../src/models/apply-removal-backup.ts";
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

// A PNG signature followed by bytes that are not valid UTF-8.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0xff, 0xfe, 0x80, 0x81, 0xc0, 0xaf, 0xf5, 0x00, 0x01, 0xed, 0xa0, 0x80,
]);
// Invalid UTF-8 on its own: a lone continuation byte, an overlong sequence, a surrogate, a truncated sequence.
const INVALID_UTF8 = Buffer.from([0x61, 0x80, 0xc0, 0xaf, 0xed, 0xa0, 0x80, 0xe2, 0x82, 0x62, 0xc3, 0x28, 0xf8]);
// Bytes that would grow if decoded then encoded: every byte value.
const EVERY_BYTE = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function write(context: TestContext, relativePath: string, bytes: Buffer | string): string {
  const full = join(context.homeDir, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, bytes);
  return full;
}

/** Records a file as written by HarnessTap, the way apply does (text hash of the bytes). */
function ownByHarnessTap(context: TestContext, relativePath: string, bytes: Buffer): void {
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
    generated_hash: hashGeneratedContent(bytes.toString("utf-8")),
  });
}

function hashTree(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (!name.endsWith(".json")) {
        hashes.set(relative(root, full), sha(readFileSync(full)));
      }
    }
  };
  walk(root);
  return hashes;
}

const BINARY_FILES: Array<[string, Buffer]> = [
  [".claude/plugins/cache/p/assets/icon.png", PNG],
  [".claude/plugins/cache/p/fonts/face.woff2", EVERY_BYTE],
  [".claude/plugins/cache/p/blob.bin", INVALID_UTF8],
  [".claude/plugins/cache/p/notes.md", Buffer.from("text with caf\u00e9 and \u{1f600}\r\nsecond line\n")],
];

describe("revert restores file bytes exactly", () => {
  it("round-trips binary files kept as trash references", async () => {
    const context = await createInitializedTestContext("snap-binary-trash-");
    try {
      const paths = BINARY_FILES.map(([path]) => path);
      for (const [path, bytes] of BINARY_FILES) {
        write(context, path, bytes);
        ownByHarnessTap(context, path, bytes);
      }
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [],
        removalBackedPaths: paths,
      });
      expect(state.trashed_files).toEqual(paths);
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });

      const removal = executeSafeFileRemovals(context.homeDir, paths, {
        applyId: snapshot.id,
        snapshotId: snapshot.id,
      });
      expect(removal.removed).toHaveLength(paths.length);
      for (const path of paths) expect(existsSync(join(context.homeDir, path))).toBe(false);

      const plan = resolveRevertPlan(snapshot.id);
      if ("error" in plan) throw new Error(plan.error);
      const result = executeRevert(plan);
      expect(result.warnings).toEqual([]);
      for (const [path, bytes] of BINARY_FILES) {
        expect(sha(readFileSync(join(context.homeDir, path)))).toBe(sha(bytes));
      }
    } finally {
      await context.cleanup();
    }
  });

  it("round-trips binary files kept as legacy database rows", async () => {
    const context = await createInitializedTestContext("snap-binary-blob-");
    try {
      const paths = BINARY_FILES.map(([path]) => path);
      const snapshot = createGlobalApplySnapshot({
        profile_name: "p",
        plugin_ids: [],
        state: { plugins: [], resources: [], platform_files: {}, trashed_files: paths },
      });
      for (const [path, bytes] of BINARY_FILES) {
        recordApplyRemovalBackup({
          apply_id: snapshot.id,
          snapshot_id: snapshot.id,
          relative_path: path,
          content: bytes,
          mode: 0o644,
        });
      }
      const plan = resolveRevertPlan(snapshot.id);
      if ("error" in plan) throw new Error(plan.error);
      const result = executeRevert(plan);
      expect(result.warnings).toEqual([]);
      for (const [path, bytes] of BINARY_FILES) {
        expect(sha(readFileSync(join(context.homeDir, path)))).toBe(sha(bytes));
      }
    } finally {
      await context.cleanup();
    }
  });

  it("restores a binary file the snapshot captured from disk, through the stored snapshot", async () => {
    const context = await createInitializedTestContext("snap-binary-disk-");
    try {
      const generated = ".claude/plugins/cache/p/generated.png";
      const extra = ".claude/plugins/cache/p/extra.bin";
      const text = ".claude/plugins/cache/p/plain.md";
      write(context, generated, PNG);
      write(context, extra, EVERY_BYTE);
      write(context, text, "plain\n");
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [{ platformId: "claude-code", files: [{ path: generated }, { path: text }] }],
        extraPaths: [extra],
      });
      expect(Object.keys(state.disk_files_base64 ?? {}).sort()).toEqual([extra, generated].sort());
      expect(Object.keys(state.disk_files ?? {})).toEqual([text]);
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      expect(getGlobalApplySnapshot(snapshot.id)?.state.disk_files_base64?.[generated]).toBe(PNG.toString("base64"));

      writeFileSync(join(context.homeDir, generated), "changed");
      writeFileSync(join(context.homeDir, extra), "changed");
      ownByHarnessTap(context, generated, Buffer.from("changed"));
      ownByHarnessTap(context, extra, Buffer.from("changed"));

      const plan = resolveRevertPlan(snapshot.id);
      if ("error" in plan) throw new Error(plan.error);
      const result = executeRevert(plan);
      expect(result.warnings).toEqual([]);
      expect(sha(readFileSync(join(context.homeDir, generated)))).toBe(sha(PNG));
      expect(sha(readFileSync(join(context.homeDir, extra)))).toBe(sha(EVERY_BYTE));
    } finally {
      await context.cleanup();
    }
  });

  it("leaves a binary file the user changed alone when it is not HarnessTap's", async () => {
    const context = await createInitializedTestContext("snap-binary-user-");
    try {
      const path = ".claude/plugins/cache/p/user.png";
      write(context, path, PNG);
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [],
        extraPaths: [path],
      });
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      const mine = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xfe, 0xfe]);
      write(context, path, mine);
      const plan = resolveRevertPlan(snapshot.id);
      if ("error" in plan) throw new Error(plan.error);
      executeRevert(plan);
      expect(sha(readFileSync(join(context.homeDir, path)))).toBe(sha(mine));
    } finally {
      await context.cleanup();
    }
  });
});

describe("use default then revert", () => {
  it("leaves every non-JSON file byte for byte as it was before default", async () => {
    const context = await createInitializedTestContext("snap-binary-use-default-");
    try {
      await importPluginFromGitHubRef("DietrichGebert/ponytail", {
        refreshGit: async (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(ponytailLayoutFixture, opts.targetDir, { recursive: true });
          mkdirSync(join(opts.targetDir, "assets"), { recursive: true });
          writeFileSync(join(opts.targetDir, "assets/logo.png"), PNG);
          writeFileSync(join(opts.targetDir, "assets/face.woff2"), EVERY_BYTE);
          writeFileSync(join(opts.targetDir, "assets/invalid.bin"), INVALID_UTF8);
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
      const before = hashTree(claudeRoot);
      const binaries = [...before.keys()].filter((path) => /\.(png|woff2|bin)$/.test(path));
      expect(binaries.length).toBeGreaterThanOrEqual(3);

      const backToDefault = await applyProfilePlugin("default", { harness: "claude-code", conflictPolicy: "replace" });
      expect(backToDefault.cancelled).toBe(false);
      const snapshotId = backToDefault.snapshot_id;
      if (!snapshotId) throw new Error("Expected a snapshot id from use default");
      const during = hashTree(claudeRoot);
      for (const path of binaries) expect(during.has(path)).toBe(false);

      const plan = resolveRevertPlan(snapshotId);
      if ("error" in plan) throw new Error(plan.error);
      executeRevert(plan);

      const after = hashTree(claudeRoot);
      for (const path of binaries) expect(after.get(path)).toBe(before.get(path));
      expect([...after.entries()].filter(([path, hash]) => before.get(path) !== hash)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
