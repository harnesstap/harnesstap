import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  listMaterializationsForRootPath,
  recordResourceMaterialization,
} from "../../src/models/resource-materialization.ts";
import { recordPreexistingPath } from "../../src/models/preexisting-path.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import { applyTrashRoot } from "../../src/services/safe-file-removal.ts";
import { repairLegacyHarnessEmits } from "../../src/services/legacy-emit-repair.ts";
import { writeFiles } from "../../src/services/applier.ts";

function write(root: string, relative: string, content: string): string {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

function own(
  root: string,
  platformId: string,
  relative: string,
  generated: string,
  rule: { name: string; content: string },
): void {
  const resource = createResource({
    type: "rule",
    name: rule.name,
    description: "",
    content: rule.content,
    metadata: { globs: [], always_apply: true },
    source: "manual",
  });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "project",
    root_path: root,
    platform_id: platformId,
    path: relative,
    action: "delete-file",
    ownership_key: `rule:${rule.name}`,
    generated_hash: hashGeneratedContent(generated),
  });
}

const API_BLOCK = "## api\n\nUse Zod";

describe("legacy emit repair", () => {
  it("backs up and removes a .roomodes HarnessTap wrote whole", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-owned");
    try {
      const root = context.projectDir;
      const full = write(root, ".roomodes", API_BLOCK);
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });

      const result = repairLegacyHarnessEmits(root, [], { applyId: "roo-owned" });

      expect(result.removed).toEqual([".roomodes"]);
      expect(existsSync(full)).toBe(false);
      expect(readFileSync(join(applyTrashRoot(), "roo-owned", ".roomodes"), "utf-8")).toBe(
        API_BLOCK,
      );
      expect(listMaterializationsForRootPath(root, ".roomodes")).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps the user's modes in a .roomodes the user also edited and strips only HarnessTap's rules", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-mixed");
    try {
      const root = context.projectDir;
      const userModes = "customModes:\n  - slug: docs\n    name: Docs";
      const full = write(root, ".roomodes", `${userModes}\n\n${API_BLOCK}`);
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });

      const result = repairLegacyHarnessEmits(root, [], { applyId: "roo-mixed" });

      expect(result.removed).toEqual([]);
      expect(result.rewritten).toEqual([".roomodes"]);
      expect(readFileSync(full, "utf-8")).toBe(`${userModes}\n`);
      expect(readFileSync(join(applyTrashRoot(), "roo-mixed", ".roomodes"), "utf-8")).toBe(
        `${userModes}\n\n${API_BLOCK}`,
      );
      expect(result.warnings.join("\n")).toContain("kept your content");
      expect(listMaterializationsForRootPath(root, ".roomodes")).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("skips and warns when HarnessTap's rule block in .roomodes was edited", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-edited");
    try {
      const root = context.projectDir;
      const edited = "## api\n\nUse Zod, and also Valibot";
      const full = write(root, ".roomodes", edited);
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });

      const result = repairLegacyHarnessEmits(root, []);

      expect(result.removed).toEqual([]);
      expect(result.rewritten).toEqual([]);
      expect(readFileSync(full, "utf-8")).toBe(edited);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(".roo/rules/");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps a section the user added a paragraph under and warns", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-appended");
    try {
      const root = context.projectDir;
      const userModes = "customModes:\n  - slug: docs\n    name: Docs";
      const appended = `${API_BLOCK}\n\nAlso prefer Valibot for new code.`;
      const testsBlock = "## tests\n\nUse bun test";
      const original = `${userModes}\n\n${appended}\n\n${testsBlock}\n`;
      const full = write(root, ".roomodes", original);
      own(root, "roo", ".roomodes", `${API_BLOCK}\n\n${testsBlock}`, {
        name: "api",
        content: "Use Zod",
      });
      own(root, "roo", ".roomodes", `${API_BLOCK}\n\n${testsBlock}`, {
        name: "tests",
        content: "Use bun test",
      });

      const result = repairLegacyHarnessEmits(root, [], { applyId: "roo-appended" });

      const after = readFileSync(full, "utf-8");
      expect(after).toContain("Also prefer Valibot for new code.");
      expect(after).toContain(appended);
      expect(after).toContain(userModes);
      expect(after).not.toContain(testsBlock);
      expect(readFileSync(join(applyTrashRoot(), "roo-appended", ".roomodes"), "utf-8")).toBe(
        original,
      );
      expect(result.warnings.join("\n")).toContain("kept rule section api in .roomodes");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps the whole file when its only section has a user paragraph", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-appended-only");
    try {
      const root = context.projectDir;
      const appended = `${API_BLOCK}\n\nMy own note.\n`;
      const full = write(root, ".roomodes", appended);
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });

      const result = repairLegacyHarnessEmits(root, []);

      expect(result.removed).toEqual([]);
      expect(result.rewritten).toEqual([]);
      expect(readFileSync(full, "utf-8")).toBe(appended);
      expect(result.warnings.join("\n")).toContain("kept rule section api");
    } finally {
      await context.cleanup();
    }
  });

  it("never touches a .roomodes that existed before HarnessTap wrote it", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-preexisting");
    try {
      const root = context.projectDir;
      const full = write(root, ".roomodes", API_BLOCK);
      recordPreexistingPath({
        root_path: root,
        path: ".roomodes",
        content_hash: hashGeneratedContent("customModes: []\n"),
      });
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });

      const result = repairLegacyHarnessEmits(root, []);

      expect(result.removed).toEqual([]);
      expect(readFileSync(full, "utf-8")).toBe(API_BLOCK);
      expect(result.warnings).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("leaves a .roomodes HarnessTap never wrote alone, silently", async () => {
    const context = await createInitializedTestContext("legacy-roomodes-user");
    try {
      const root = context.projectDir;
      const full = write(root, ".roomodes", "customModes: []\n");
      const result = repairLegacyHarnessEmits(root, []);
      expect(result).toEqual({ removed: [], rewritten: [], warnings: [] });
      expect(readFileSync(full, "utf-8")).toBe("customModes: []\n");
    } finally {
      await context.cleanup();
    }
  });

  it("removes owned antigravity workflows with a backup and skips edited or unmanaged ones", async () => {
    const context = await createInitializedTestContext("legacy-workflows");
    try {
      const root = context.projectDir;
      const owned = write(root, ".agents/workflows/ship.md", "# Ship\n");
      own(root, "antigravity", ".agents/workflows/ship.md", "# Ship\n", {
        name: "ship",
        content: "# Ship",
      });
      const edited = write(root, ".agents/workflows/review.md", "# Review, my way\n");
      own(root, "antigravity", ".agents/workflows/review.md", "# Review\n", {
        name: "review",
        content: "# Review",
      });
      const mine = write(root, ".agents/workflows/mine.md", "# Mine\n");

      const result = repairLegacyHarnessEmits(root, [], { applyId: "agy-workflows" });

      expect(result.removed).toEqual([".agents/workflows/ship.md"]);
      expect(existsSync(owned)).toBe(false);
      expect(
        readFileSync(join(applyTrashRoot(), "agy-workflows", ".agents/workflows/ship.md"), "utf-8"),
      ).toBe("# Ship\n");
      expect(readFileSync(edited, "utf-8")).toBe("# Review, my way\n");
      expect(readFileSync(mine, "utf-8")).toBe("# Mine\n");
      const warnings = result.warnings.join("\n");
      expect(warnings).toContain("review.md");
      expect(warnings).toContain("kept 1 file in .agents/workflows/ HarnessTap did not write");
      expect(warnings).toContain("/migrate-workflows");
    } finally {
      await context.cleanup();
    }
  });

  it("does not remove a legacy path the current apply still writes", async () => {
    const context = await createInitializedTestContext("legacy-still-desired");
    try {
      const root = context.projectDir;
      const full = write(root, ".roomodes", API_BLOCK);
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });
      const result = repairLegacyHarnessEmits(root, [{ path: ".roomodes", content: API_BLOCK }]);
      expect(result.removed).toEqual([]);
      expect(existsSync(full)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("runs during writeFiles and prints its warnings", async () => {
    const context = await createInitializedTestContext("legacy-write-files");
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const root = context.projectDir;
      write(root, ".roomodes", API_BLOCK);
      own(root, "roo", ".roomodes", API_BLOCK, { name: "api", content: "Use Zod" });
      write(root, ".agents/workflows/review.md", "# Review, my way\n");
      own(root, "antigravity", ".agents/workflows/review.md", "# Review\n", {
        name: "review",
        content: "# Review",
      });

      writeFiles([{ path: ".roo/rules/api.md", content: "Use Zod" }], root);

      expect(existsSync(join(root, ".roomodes"))).toBe(false);
      expect(readFileSync(join(root, ".roo/rules/api.md"), "utf-8")).toContain("Use Zod");
      expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
        "warning: ",
      );
    } finally {
      errors.mockRestore();
      await context.cleanup();
    }
  });
});
