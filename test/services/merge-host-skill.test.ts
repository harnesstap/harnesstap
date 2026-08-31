import { describe, expect, it } from "bun:test";
import { mergeClaudeSettingsContent } from "../../src/services/merged-host-config.ts";
import { mergeSkillMarkdown } from "../../src/services/merge-skill-markdown.ts";

describe("mergeClaudeSettingsContent", () => {
  it("keeps unrelated live keys while overlaying profile permissions", () => {
    const live = JSON.stringify(
      {
        model: "opus",
        permissions: { allow: ["Read(*)"], deny: [] },
        env: { KEEP: "yes", DEMO_KEY: "old" },
      },
      null,
      2,
    );
    const generated = JSON.stringify(
      {
        permissions: { allow: ["Bash(*)"], deny: [] },
        env: { DEMO_KEY: "new" },
      },
      null,
      2,
    );

    const merged = JSON.parse(mergeClaudeSettingsContent(live, generated)) as {
      model: string;
      permissions: { allow: string[] };
      env: Record<string, string>;
    };

    expect(merged.model).toBe("opus");
    expect(merged.permissions.allow).toEqual(["Bash(*)"]);
    expect(merged.env).toEqual({ KEEP: "yes", DEMO_KEY: "new" });
  });
});

describe("mergeSkillMarkdown", () => {
  it("keeps extra live frontmatter and body when generated is a thin subset", () => {
    const live = [
      "---",
      "name: dolibarr-development",
      "description: short",
      "allowed-tools: Read",
      "---",
      "",
      "# Dolibarr Developer Skill",
      "## When to Use",
      "Lots of live guidance.",
    ].join("\n");
    const generated = [
      "---",
      "name: dolibarr-development",
      "description: short",
      "---",
      "",
    ].join("\n");

    const merged = mergeSkillMarkdown(live, generated);
    expect(merged).toContain("allowed-tools: Read");
    expect(merged).toContain("# Dolibarr Developer Skill");
    expect(merged).toContain("Lots of live guidance.");
  });

  it("replaces the body when the profile snapshot is a real rewrite", () => {
    const live = "---\nname: ship\ndescription: d\n---\n\n# live\n";
    const generated = "---\nname: ship\ndescription: d\n---\n\n# profile rewrite\n";
    expect(mergeSkillMarkdown(live, generated)).toContain("# profile rewrite");
    expect(mergeSkillMarkdown(live, generated)).not.toContain("# live");
  });
});
