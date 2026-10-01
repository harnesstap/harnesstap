import { describe, expect, it } from "bun:test";
import { unionHarnessResources } from "../../src/services/harness-resource-union.ts";
import type { ResourceCreateInput } from "../../src/types.ts";

function skill(name: string, content: string, source: string): ResourceCreateInput {
  return {
    type: "skill",
    name,
    description: "",
    content,
    metadata: {},
    source,
  };
}

function mcp(name: string, command: string, source: string): ResourceCreateInput {
  return {
    type: "mcp_server",
    name,
    description: "",
    content: "",
    metadata: { transport: "stdio", command },
    source,
  };
}

describe("unionHarnessResources", () => {
  it("unions distinct identities from every harness", () => {
    const result = unionHarnessResources(
      [
        {
          platformId: "claude-code",
          resources: [skill("alpha", "from claude", ".claude/skills/alpha/SKILL.md")],
        },
        {
          platformId: "cursor",
          resources: [mcp("github", "npx", ".cursor/mcp.json")],
        },
      ],
      "last-write",
    );

    expect(result.resources.map((resource) => resource.name).sort()).toEqual([
      "alpha",
      "github",
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps the later registered copy when the same identity differs and mtimes tie", () => {
    const result = unionHarnessResources(
      [
        {
          platformId: "cursor",
          resources: [skill("shared", "cursor body", ".agents/skills/shared/SKILL.md")],
        },
        {
          platformId: "claude-code",
          resources: [skill("shared", "claude body", ".claude/skills/shared/SKILL.md")],
        },
      ],
      "last-write",
    );

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.content).toBe("claude body");
    expect(result.conflicts).toEqual([
      {
        identity: "skill:shared:",
        winnerPlatformId: "claude-code",
        loserPlatformId: "cursor",
      },
    ]);
  });

  it("keeps the newest mtime when the same identity differs", () => {
    const result = unionHarnessResources(
      [
        {
          platformId: "cursor",
          resources: [skill("shared", "cursor body", ".agents/skills/shared/SKILL.md")],
          mtimesMs: new Map([["skill:shared:", 200]]),
        },
        {
          platformId: "claude-code",
          resources: [skill("shared", "claude body", ".claude/skills/shared/SKILL.md")],
          mtimesMs: new Map([["skill:shared:", 100]]),
        },
      ],
      "last-write",
    );

    expect(result.resources[0]?.content).toBe("cursor body");
    expect(result.conflicts[0]?.winnerPlatformId).toBe("cursor");
  });
});
