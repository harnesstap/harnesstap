import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateFiles } from "../../src/services/applier.ts";
import { runInStatusComputation } from "../../src/services/status-computation.ts";
import { readOwnershipMemoHits } from "../../src/services/materialization-ownership.ts";
import {
  clearUnicodeScanCache,
  readUnicodeScanComputeCount,
  scanUnicodeText,
} from "../../src/services/unicode-scan.ts";
import {
  fileContentsEquivalentForDrift,
  normalizeLineEndingsAndTrailingNewlines,
} from "../../src/services/file-contents-drift.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  listMaterializationsForRootPath,
  recordResourceMaterialization,
} from "../../src/models/resource-materialization.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";

const SKILL = ".claude/skills/cache-check";

function seedSkill(sourceRoot: string): string {
  const dir = join(sourceRoot, SKILL);
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: cache-check\ndescription: d\n---\nbody\n");
  writeFileSync(join(dir, "references/one.md"), "# one\n");
  writeFileSync(join(dir, "references/two.md"), "# two\n");
  return dir;
}

function skillResource(sourceRoot: string) {
  return makeResource({
    type: "skill",
    name: "cache-check",
    description: "d",
    content: "body\n",
    source: `${SKILL}/SKILL.md`,
    origin_ref: sourceRoot,
    metadata: { references: ["one.md", "two.md"], companions: ["references/one.md", "references/two.md"] },
  });
}

async function statusGenerate(resource: ReturnType<typeof skillResource>, root: string, sourceRoot: string) {
  return runInStatusComputation(async () => {
    const [result] = await generateFiles([resource], ["claude-code"], root, {
      target: "global",
      skillSourceRoot: sourceRoot,
      pinSkillEmits: false,
    });
    return new Map((result?.files ?? []).map((file) => [file.path, file]));
  });
}

describe("status recompute caches", () => {
  it("re-reads a companion whose content changes and tracks added and removed companions", async () => {
    const sourceRoot = createTempDir("status-cache-source");
    const context = await createInitializedTestContext("status-recompute-caches");
    try {
      const dir = seedSkill(sourceRoot);
      const resource = skillResource(sourceRoot);
      const one = `${SKILL}/references/one.md`;

      const first = await statusGenerate(resource, context.homeDir, sourceRoot);
      expect(first.get(one)?.content).toBe("# one\n");
      expect(first.get(one)?.ownership?.[0]?.resource_id).toBe(resource.id);

      const hitsBefore = readOwnershipMemoHits();
      const second = await statusGenerate(resource, context.homeDir, sourceRoot);
      expect(readOwnershipMemoHits()).toBeGreaterThan(hitsBefore);
      expect([...second.keys()].sort()).toEqual([...first.keys()].sort());

      // Same length, so only the stat identity tells the cache it changed.
      writeFileSync(join(dir, "references/one.md"), "# ONE\n");
      const later = new Date(Date.now() + 5_000);
      utimesSync(join(dir, "references/one.md"), later, later);
      const edited = await statusGenerate(resource, context.homeDir, sourceRoot);
      expect(edited.get(one)?.content).toBe("# ONE\n");

      writeFileSync(join(dir, "references/three.md"), "# three\n");
      const added = await statusGenerate(resource, context.homeDir, sourceRoot);
      const three = added.get(`${SKILL}/references/three.md`);
      expect(three?.content).toBe("# three\n");
      expect(three?.ownership?.[0]?.resource_id).toBe(resource.id);

      rmSync(join(dir, "references/two.md"));
      const removed = await statusGenerate(resource, context.homeDir, sourceRoot);
      expect(removed.has(`${SKILL}/references/two.md`)).toBe(false);
      expect(removed.get(`${SKILL}/references/three.md`)?.ownership?.[0]?.resource_id).toBe(resource.id);
    } finally {
      await context.cleanup();
      cleanupDir(sourceRoot);
    }
  });

  it("keeps unicode results for more files than one recompute plans and rescans changed content", () => {
    clearUnicodeScanCache();
    const contents = Array.from({ length: 600 }, (_, index) => `file ${index} caf\u00e9\n`);
    const start = readUnicodeScanComputeCount();
    for (const [index, content] of contents.entries()) scanUnicodeText(content, `f${index}.md`);
    expect(readUnicodeScanComputeCount() - start).toBe(600);
    for (const [index, content] of contents.entries()) scanUnicodeText(content, `f${index}.md`);
    expect(readUnicodeScanComputeCount() - start).toBe(600);

    const hidden = `file 0 caf\u00e9\u200b\n`;
    const findings = scanUnicodeText(hidden, "f0.md");
    expect(readUnicodeScanComputeCount() - start).toBe(601);
    expect(findings.some((finding) => finding.codepoint === "U+200B")).toBe(true);
  });

  it("answers drift equivalence from the current strings, not the last answer for the path", () => {
    expect(fileContentsEquivalentForDrift("a.md", "x\n\n", "x")).toBe(true);
    expect(fileContentsEquivalentForDrift("a.md", "y\n", "x")).toBe(false);
    expect(fileContentsEquivalentForDrift("a.md", "x\r\n", "x")).toBe(true);
    expect(fileContentsEquivalentForDrift("a.md", "x\n", "x!")).toBe(false);
  });

  it("normalizes like the regex it replaces", () => {
    const regex = (value: string) => value.replace(/\r\n/g, "\n").replace(/\n+$/u, "");
    for (const value of ["", "\n", "\n\n", "a", "a\n", "a\r\n", "a\r\n\r\n", "a\n\r", "\r", "a\r", "\na\n\n", "a\r\r\n"]) {
      expect(normalizeLineEndingsAndTrailingNewlines(value)).toBe(regex(value));
    }
  });

  it("serves per-path materialization lookups in a status computation like the direct query", async () => {
    const context = await createInitializedTestContext("status-recompute-materializations");
    try {
      const resource = createResource({ type: "skill", name: "m", description: "", content: "x", metadata: {}, source: "manual" });
      for (const path of ["a/SKILL.md", "b/SKILL.md", "a/SKILL.md"]) {
        recordResourceMaterialization({
          resource_id: resource.id,
          scope: "global",
          root_path: context.homeDir,
          platform_id: path.startsWith("a") ? "claude-code" : "cursor",
          path,
          action: "delete-file",
          ownership_key: "skill:m",
          generated_hash: `sha256:${path}`,
        });
      }
      const direct = ["a/SKILL.md", "b/SKILL.md", "c/SKILL.md"].map((path) =>
        listMaterializationsForRootPath(context.homeDir, path));
      const inStatus = runInStatusComputation(() =>
        ["a/SKILL.md", "b/SKILL.md", "c/SKILL.md"].map((path) =>
          listMaterializationsForRootPath(context.homeDir, path)));
      expect(inStatus).toEqual(direct);
    } finally {
      await context.cleanup();
    }
  });
});
