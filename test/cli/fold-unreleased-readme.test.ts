import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { foldReadme } from "../../scripts/fold-unreleased-readme.ts";

const root = resolve(import.meta.dirname, "../..");

const readme = [
  "# Title",
  "",
  "## Install",
  "",
  "```bash",
  "# not a heading",
  "ht init",
  "```",
  "",
  "---",
  "",
  "## Quick start",
  "",
  "Old text.",
  "",
  "### Machine",
  "",
  "Old machine text.",
  "",
].join("\n");

const header = "# Pending README text\n\nNotes for contributors.\n";

describe("fold unreleased README text", () => {
  it("appends to and replaces sections, then empties the pending file", () => {
    const pending = [
      header,
      "## Install",
      "",
      "<!-- append -->",
      "",
      "Extra install note.",
      "",
      "## Machine",
      "",
      "<!-- replace -->",
      "",
      "New machine text.",
      "",
    ].join("\n");
    const result = foldReadme(readme, pending);
    expect(result.readme).toContain("ht init\n```\n\nExtra install note.\n\n---");
    expect(result.readme).toContain("### Machine\n\nNew machine text.\n");
    expect(result.readme).not.toContain("Old machine text.");
    expect(result.readme).toContain("Old text.");
    expect(result.pending).toBe(header);
    expect(result.folded).toEqual(["append Install", "replace Machine"]);
  });

  it("leaves README untouched when nothing is pending", () => {
    const result = foldReadme(readme, header);
    expect(result.readme).toBe(readme);
    expect(result.folded).toEqual([]);
  });

  it("fails loudly on unknown targets, missing directives, and body headings", () => {
    expect(() => foldReadme(readme, `${header}\n## Missing\n\n<!-- append -->\n\nText.\n`)).toThrow(/exactly one/);
    expect(() => foldReadme(readme, `${header}\n## Install\n\nText.\n`)).toThrow(/<!-- append -->/);
    expect(() => foldReadme(readme, `${header}\n## Install\n\n<!-- append -->\n\n### Nested\n`)).toThrow(/only "## /);
  });

  it("folds the checked-in pending file into the checked-in README", () => {
    const pending = readFileSync(resolve(root, "docs/unreleased-readme.md"), "utf-8");
    expect(() => foldReadme(readFileSync(resolve(root, "README.md"), "utf-8"), pending)).not.toThrow();
  });
});
