import { describe, expect, it } from "bun:test";
import {
  affectedResourcesForManagedFileDiff,
  withAffectedResources,
} from "../../src/services/scoped-file-content-delta.ts";

describe("affectedResourcesForManagedFileDiff", () => {
  it("lists only MCP servers whose scoped fragment actually changed", () => {
    const expected = JSON.stringify({
      mcpServers: {
        devel: { url: "https://example.com/devel" },
        other: { url: "https://example.com/other" },
      },
    });
    const current = JSON.stringify({
      mcpServers: {
        devel: { url: "https://example.com/devel" },
        other: { url: "https://example.com/other-live" },
      },
    });

    expect(
      affectedResourcesForManagedFileDiff({
        path: ".claude.json",
        expected,
        current,
      }),
    ).toEqual([{ type: "mcp_server", name: "other" }]);
  });

  it("lists only permissions whose scoped fragment actually changed", () => {
    const expected = JSON.stringify({
      permissions: {
        allow: ["Bash(jk:*)", "Read"],
      },
    });
    const current = JSON.stringify({
      permissions: {
        allow: ["Bash(jk:*)", "Write"],
      },
    });

    expect(
      affectedResourcesForManagedFileDiff({
        path: ".claude/settings.json",
        expected,
        current,
      }),
    ).toEqual([
      { type: "permission", name: "allow-Read" },
      { type: "permission", name: "allow-Write" },
    ]);
  });

  it("treats a trailing-newline-only skill or subagent body as empty", () => {
    const skillPath = ".claude/skills/ubiquitous-language/SKILL.md";
    const agentPath = ".claude/agents/code-reviewer.md";
    const skillBody = "---\nname: ubiquitous-language\n---\n\n# ubiquitous-language";
    const agentBody = "---\nname: code-reviewer\n---\n\nReview the diff.";

    expect(
      affectedResourcesForManagedFileDiff({
        path: skillPath,
        expected: skillBody,
        current: `${skillBody}\n`,
      }),
    ).toEqual([]);
    expect(
      withAffectedResources(
        { path: skillPath, type: "modified" },
        skillBody,
        `${skillBody}\n`,
      ).affected_resources,
    ).toEqual([]);

    expect(
      affectedResourcesForManagedFileDiff({
        path: agentPath,
        expected: agentBody,
        current: `${agentBody}\n`,
      }),
    ).toEqual([]);
    expect(
      withAffectedResources(
        { path: agentPath, type: "modified" },
        agentBody,
        `${agentBody}\n`,
      ).affected_resources,
    ).toEqual([]);
  });

  it("lists a skill or subagent when the scoped body actually changed", () => {
    expect(
      affectedResourcesForManagedFileDiff({
        path: ".claude/skills/ubiquitous-language/SKILL.md",
        expected: "# original\n",
        current: "# live\n",
      }),
    ).toEqual([{ type: "skill", name: "ubiquitous-language" }]);
    expect(
      affectedResourcesForManagedFileDiff({
        path: ".claude/agents/code-reviewer.md",
        expected: "Review carefully.\n",
        current: "Review the live copy.\n",
      }),
    ).toEqual([{ type: "agent", name: "code-reviewer" }]);
  });
});
