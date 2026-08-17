import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { DeepSeekHarnessSerializer } from "../../src/platforms/deepseek-harness.ts";
import { detectPlatforms } from "../../src/services/scanner.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

describe("DeepSeekHarnessSerializer project", () => {
  it("scans instructions, preferred skills, alternate skills, and hooks", async () => {
    const projectDir = createTempDir("dsh-scan");
    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# DSH project\n");
      writeTextFile(join(projectDir, "CLAUDE.md"), "# DSH project\n");
      writeTextFile(
        join(projectDir, ".dsh/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom dsh.\n",
      );
      writeTextFile(
        join(projectDir, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom agents.\n",
      );
      writeTextFile(
        join(projectDir, ".agents/skills/extra/SKILL.md"),
        "---\nname: extra\ndescription: Extra\n---\nOnly agents.\n",
      );
      writeTextFile(
        join(projectDir, ".dsh/hooks/safety.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "bin/check.sh", timeout: 10 }],
              },
            ],
          },
        }),
      );

      expect(detectPlatforms(projectDir)).toContain("deepseek-harness");

      const resources = await new DeepSeekHarnessSerializer().scan(projectDir);
      const skills = resources.filter((r) => r.type === "skill");
      expect(skills.find((r) => r.name === "review")?.content).toContain("From dsh.");
      expect(skills.filter((r) => r.name === "review")).toHaveLength(1);
      expect(skills.some((r) => r.name === "extra")).toBe(true);
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({ type: "hook", source: ".dsh/hooks/safety.json" }),
        ]),
      );
      expect(resources.some((r) => r.type === "mcp_server")).toBe(false);
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("serializes project files without a home patch", async () => {
    const files = await new DeepSeekHarnessSerializer().serialize(
      [
        makeResource({ type: "instruction", name: "dsh", content: "# DSH" }),
        makeResource({
          type: "skill",
          name: "review",
          description: "Review helper",
          content: "# Review",
        }),
        makeResource({
          type: "hook",
          name: "PreToolUse-Bash",
          content: "bin/check.sh",
          metadata: {
            event: "PreToolUse",
            script: "bin/check.sh",
            matcher: "Bash",
            timeout: 10,
          },
        }),
        makeResource({
          type: "mcp_server",
          name: "docs",
          metadata: { transport: "stdio", command: "docs-mcp" },
        }),
      ],
      ".",
      { target: "project" },
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".dsh/skills/review/SKILL.md",
        ".dsh/hooks/harnesstap.json",
      ]),
    );
    expect(files.map((file) => file.path).join("\n")).not.toContain("cordis.patch.yml");
    expect(files.find((file) => file.path === ".dsh/hooks/harnesstap.json")?.content).toContain(
      "PreToolUse",
    );
  });
});
