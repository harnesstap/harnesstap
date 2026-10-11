import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { foldPending, loadPendingDocuments, parsePending } from "../../scripts/fold-unreleased-readme.ts";

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

const reference = [
  "# Reference",
  "",
  "## plugin",
  "",
  "### Commands",
  "",
  "- `plugin list`",
  "",
  "### Important options",
  "",
  "- `plugin list --format json`",
  "",
  "## auth",
  "",
  "### Commands",
  "",
  "- `auth login`",
  "",
  "## profile",
  "",
  "Profiles.",
  "",
].join("\n");

const header = "# Pending README text\n\nNotes for contributors.\n";
const docs = { "README.md": readme, "docs/cli/command-reference.md": reference };

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
    const result = foldPending(docs, pending);
    const folded = result.documents["README.md"] as string;
    expect(folded).toContain("ht init\n```\n\nExtra install note.\n\n---");
    expect(folded).toContain("### Machine\n\nNew machine text.\n");
    expect(folded).not.toContain("Old machine text.");
    expect(folded).toContain("Old text.");
    expect(result.documents["docs/cli/command-reference.md"]).toBe(reference);
    expect(result.pending).toBe(header);
    expect(result.folded).toEqual(["append README.md > Install", "replace README.md > Machine"]);
  });

  it("targets another file, disambiguates repeated headings, and inserts new sections", () => {
    const pending = [
      header,
      "## docs/cli/command-reference.md > auth > Commands",
      "",
      "<!-- append -->",
      "",
      "- `auth logout`",
      "",
      "## docs/cli/command-reference.md > plugin",
      "",
      "<!-- insert-after -->",
      "",
      "### github",
      "",
      "Sign in with GitHub.",
      "",
      "#### Commands",
      "",
      "- `github login`",
      "",
    ].join("\n");
    const folded = foldPending(docs, pending).documents["docs/cli/command-reference.md"] as string;
    expect(folded).toContain("- `auth login`\n\n- `auth logout`\n\n## profile");
    expect(folded).toContain("- `plugin list --format json`\n\n## github\n\nSign in with GitHub.\n\n### Commands\n\n- `github login`\n\n## auth");

  });

  it("leaves documents untouched when nothing is pending", () => {
    const result = foldPending(docs, header);
    expect(result.documents).toEqual(docs);
    expect(result.folded).toEqual([]);
  });

  it("names the section when it has no mode marker (the unmarked format)", () => {
    const unmarked = [
      "# Unreleased README changes",
      "",
      "## Catalog and Cloud",
      "",
      "`plugin list` reads the local library by default.",
      "",
      "## Command reference (`docs/cli/command-reference.md`)",
      "",
      "- `plugin list` lists local plugins.",
      "",
    ].join("\n");
    const run = () => parsePending(unmarked);
    expect(run).toThrow(/docs\/unreleased-readme\.md:3 section "Catalog and Cloud" has no mode marker/);
    expect(run).toThrow(/<!-- append -->, <!-- replace --> or <!-- insert-after -->/);
    expect(run).toThrow(/## docs\/cli\/command-reference\.md > <Heading in that file>/);
  });

  it("fails loudly on unknown targets, unknown modes, ambiguous targets, and body headings", () => {
    const fold = (body: string) => () => foldPending(docs, `${header}\n${body}\n`);
    expect(fold("## Missing\n\n<!-- append -->\n\nText.")).toThrow(/matches 0 headings/);
    expect(fold("## docs/cli/command-reference.md > Commands\n\n<!-- append -->\n\nText.")).toThrow(/matches 2 headings/);
    expect(fold("## Install\n\n<!-- merge -->\n\nText.")).toThrow(/unknown mode/);
    expect(fold("## Install\n\n<!-- append -->\n\n### Nested\n\nText.")).toThrow(/only insert-after sections/);
    expect(fold("## docs/missing.md > Install\n\n<!-- append -->\n\nText.")).toThrow(/not provided/);
    expect(fold("## ../secret.md > Install\n\n<!-- append -->\n\nText.")).toThrow(/must be README\.md or a docs\//);
  });

  it("folds the checked-in pending file into the checked-in documents", () => {
    const pending = readFileSync(resolve(root, "docs/unreleased-readme.md"), "utf-8");
    const result = foldPending(loadPendingDocuments(root, pending), pending);
    expect(result.pending).toBe(`${parsePending(pending).preamble.join("\n").replace(/\n+$/, "")}\n`);
  });
});
