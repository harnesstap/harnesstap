import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { binaryExpectedFileMatchesDisk } from "../../src/services/file-contents-drift.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { importPluginFromGitHubRef } from "../../src/services/plugin-git-import.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const ponytailLayoutFixture = join(
  import.meta.dirname,
  "../fixtures/plugin-import/git-origin-ponytail",
);

// A PNG header plus bytes that are not valid UTF-8.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);

describe("status with binary files in a Claude host plugin", () => {
  it("is in sync right after apply, like apply itself", async () => {
    const context = await createInitializedTestContext("status-binary-plugin-files");
    try {
      await importPluginFromGitHubRef("DietrichGebert/ponytail", {
        refreshGit: async (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(ponytailLayoutFixture, opts.targetDir, { recursive: true });
          mkdirSync(join(opts.targetDir, "assets"), { recursive: true });
          writeFileSync(join(opts.targetDir, "assets/logo.png"), PNG);
          return { ok: true, sha: "abc123def456", message: "ok" };
        },
      });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "ponytail");
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      const applied = await applyProfilePlugin("work", { harness: "claude-code", conflictPolicy: "replace" });
      expect(applied.cancelled).toBe(false);
      setActiveProfileName("work");

      const again = await applyProfilePlugin("work", { harness: "claude-code", dryRun: true });
      const logo = again.expected_files?.find((file) => file.path.endsWith("/assets/logo.png"));
      expect(logo?.encoding).toBe("base64");
      expect(again.written_files).toEqual([]);

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.changes.map((change) => change.path).filter((path) => path.endsWith(".png"))).toEqual([]);
      expect(status.has_drift).toBe(false);

      const preview = await previewProfileApply({ profile: "work", scope: "global", harness: "claude-code" });
      expect(preview.files.changes.map((change) => change.path).filter((path) => path.endsWith(".png"))).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});

describe("binaryExpectedFileMatchesDisk", () => {
  it("compares base64 plan entries with the bytes on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "binary-match-"));
    try {
      const path = join(dir, "logo.png");
      writeFileSync(path, PNG);
      expect(binaryExpectedFileMatchesDisk(path, { content: PNG.toString("base64"), encoding: "base64" })).toBe(true);
      const changed = Buffer.from(PNG);
      changed[9] = 0x00;
      expect(binaryExpectedFileMatchesDisk(path, { content: changed.toString("base64"), encoding: "base64" })).toBe(false);
      expect(binaryExpectedFileMatchesDisk(join(dir, "missing.png"), { content: "", encoding: "base64" })).toBe(false);
      expect(binaryExpectedFileMatchesDisk(path, { content: "text" })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
