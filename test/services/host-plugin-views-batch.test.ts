import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  hostPluginViewWrittenHash,
  hostPluginViewsPath,
  pruneCreatedHostPluginViews,
  readHostPluginViewRecord,
  readHostPluginViewRecords,
  recordHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin-views.ts";

function makeView(home: string, name: string, files: string[]): string {
  const view = join(home, ".claude/plugins/cache/m", name, "1.0.0");
  for (const file of files) {
    mkdirSync(join(view, file, ".."), { recursive: true });
    writeFileSync(join(view, file), `${name}:${file}\n`);
  }
  return view;
}

describe("host plugin view records", () => {
  it("prunes many removed files in one pass, like pruning them one by one", async () => {
    const context = await createInitializedTestContext("views-batch");
    try {
      const created = makeView(context.homeDir, "made", ["skills/a/SKILL.md", "skills/a/x.md", "b.md"]);
      const theirs = makeView(context.homeDir, "theirs", ["one.md", "two.md", "skills/z/user.md"]);
      recordHostPluginViewFiles({
        hostView: created,
        created: true,
        files: { "skills/a/SKILL.md": "h1", "skills/a/x.md": "h2", "b.md": "h3" },
      });
      recordHostPluginViewFiles({
        hostView: theirs,
        created: false,
        files: { "one.md": "h4", "two.md": "h5" },
      });

      const { rmSync } = await import("node:fs");
      for (const file of ["skills/a/SKILL.md", "skills/a/x.md", "b.md"]) rmSync(join(created, file));
      rmSync(join(theirs, "one.md"));
      pruneCreatedHostPluginViews([
        join(created, "skills/a/SKILL.md"),
        join(created, "skills/a/x.md"),
        join(created, "b.md"),
        join(theirs, "one.md"),
      ]);

      // Everything HarnessTap made is gone, folder and record both.
      expect(existsSync(created)).toBe(false);
      expect(readHostPluginViewRecord(created)).toBeUndefined();
      // A folder it did not create keeps its record minus the removed file, and every file on disk.
      expect(readHostPluginViewRecord(theirs)?.files).toEqual({ "two.md": "h5" });
      expect(existsSync(join(theirs, "two.md"))).toBe(true);
      expect(existsSync(join(theirs, "skills/z/user.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("sees a change made to the records file after they were read", async () => {
    const context = await createInitializedTestContext("views-cache");
    try {
      const view = makeView(context.homeDir, "p", ["a.md"]);
      recordHostPluginViewFiles({ hostView: view, created: false, files: { "a.md": "sha256:aaaa" } });
      expect(hostPluginViewWrittenHash(join(view, "a.md"))).toBe("sha256:aaaa");
      // Same length, rewritten by something else.
      const path = hostPluginViewsPath();
      writeFileSync(path, readFileSync(path, "utf8").replace("sha256:aaaa", "sha256:bbbb"));
      expect(hostPluginViewWrittenHash(join(view, "a.md"))).toBe("sha256:bbbb");
    } finally {
      await context.cleanup();
    }
  });

  it("gives callers their own copy of the records", async () => {
    const context = await createInitializedTestContext("views-copy");
    try {
      const view = makeView(context.homeDir, "p", ["a.md"]);
      recordHostPluginViewFiles({ hostView: view, created: false, files: { "a.md": "h" } });
      const first = readHostPluginViewRecords();
      for (const record of Object.values(first)) record.files["extra.md"] = "x";
      expect(readHostPluginViewRecord(view)?.files).toEqual({ "a.md": "h" });
    } finally {
      await context.cleanup();
    }
  });
});
