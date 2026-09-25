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
      "claude-code",
    );

    expect(result.resources.map((resource) => resource.name).sort()).toEqual([
      "alpha",
      "github",
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps the main harness copy when the same identity differs", () => {
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
      "claude-code",
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
});
