import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  renderResourceShow,
  truncateResourceContent,
} from "../../src/services/resource-show.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeResource(overrides: Partial<ReturnType<typeof makeResourceInput>> = {}) {
  const input = makeResourceInput({
    type: "skill",
    name: "example",
    description: "Example resource",
    content: "line 1\nline 2",
    ...overrides,
  });
  return {
    ...input,
    id: "01JEXAMPLE0000000000000000",
    namespace: input.namespace ?? "",
    origin_kind: input.origin_kind ?? "manual",
    origin_ref: input.origin_ref ?? "",
    content_hash: "abc123",
    content_blob_ref: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

describe("resource show", () => {
  it("hides extended metadata fields by default", () => {
    const output = renderResourceShow(makeResource());

    expect(output).toContain("Updated");
    expect(output).toContain("Path");
    expect(output).toContain("Local");
    expect(output).not.toContain("Content hash");
    expect(output).not.toContain("Metadata");
    expect(output).not.toMatch(/\bID\b/);
    expect(output).not.toContain("Created");
    expect(output).not.toContain("01JEXAMPLE0000000000000000");
    expect(output).not.toContain("abc123");
  });

  it("shows extended metadata fields with showAllFields", () => {
    const output = renderResourceShow(makeResource(), { showAllFields: true });

    expect(output).toContain("Content hash");
    expect(output).toContain("Source");
    expect(output).toContain("abc123");
    expect(output).toContain("01JEXAMPLE0000000000000000");
    expect(output).toContain("Created");
    expect(output).toContain("Metadata");
  });

  it("truncates content after 15 lines with a total line count", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const truncated = truncateResourceContent(lines.join("\n"));

    expect(truncated.split("\n")).toHaveLength(16);
    expect(truncated).toContain("line 15");
    expect(truncated).not.toContain("line 16");
    expect(truncated).toContain("… (20 lines in content)");
  });

  it("keeps short content unchanged", () => {
    const content = "line 1\nline 2\nline 3";
    expect(truncateResourceContent(content)).toBe(content);
  });

  it("uses Agent instructions (AGENTS.md) as the display title", () => {
    const output = renderResourceShow(
      makeResource({
        type: "instruction",
        name: "agents-instructions",
        source: "AGENTS.md",
        origin_kind: "local_snapshot",
        origin_ref: "/Users/christophe.oudar/dev/opensource/harnesstap",
      }),
    );
    expect(output).toContain("Agent instructions (AGENTS.md)");
    expect(output).toContain("Local (/Users/christophe.oudar/dev/opensource/harnesstap)");
  });

  it("shows the skill package directory as Path", () => {
    const output = renderResourceShow(
      makeResource({
        type: "skill",
        name: "archify",
        source: "/Users/me/.claude/skills/archify/SKILL.md",
      }),
    );
    expect(output).toContain("/Users/me/.claude/skills/archify");
    expect(output).not.toContain("/Users/me/.claude/skills/archify/SKILL.md");
  });

  it("lists skill package files under CONTENT", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-skill-show-"));
    tempDirs.push(root);
    const skillDir = join(root, "last30days");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    const skillMd = join(skillDir, "SKILL.md");
    writeFileSync(skillMd, "# last30days\n", "utf8");
    writeFileSync(join(skillDir, "references", "notes.md"), "notes\n", "utf8");

    const output = renderResourceShow(
      makeResource({
        type: "skill",
        name: "last30days",
        content: "",
        source: skillMd,
        origin_kind: "local_snapshot",
        origin_ref: skillMd,
      }),
    );

    expect(output).toContain(skillDir);
    expect(output).toContain("SKILL.md");
    expect(output).toContain("references/notes.md");
    expect(output).not.toContain("Nothing loaded yet.");
  });
});
