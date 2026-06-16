import { describe, expect, it } from "bun:test";
import {
  emitCodexAgentToml,
  emitMarkdownAgent,
  parseCodexAgentToml,
  parseMarkdownAgent,
} from "../../src/services/agent-bridge.ts";

const API_DESIGNER = `name = "api-designer"
description = "Use when a task needs API contract design."
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Design APIs as long-lived contracts.
"""
`;

const CLAUDE_AGENT = `---
name: release-reviewer
description: Release review specialist
model: claude-sonnet-4-5
reasoning_effort: high
sandbox_mode: workspace-write
---
# Release Reviewer
`;

describe("parseCodexAgentToml", () => {
  it("extracts canonical fields", () => {
    const agent = parseCodexAgentToml(API_DESIGNER);
    expect(agent).toEqual({
      name: "api-designer",
      description: "Use when a task needs API contract design.",
      instructions: "Design APIs as long-lived contracts.\n",
      metadata: {
        model: "gpt-5.4",
        reasoning_effort: "high",
        sandbox_mode: "read-only",
        wire_format: "codex-toml",
      },
    });
  });

  it("returns undefined for invalid TOML", () => {
    expect(parseCodexAgentToml("not valid toml [[[")).toBeUndefined();
  });
});

describe("emitCodexAgentToml", () => {
  it("round-trips api-designer shape", () => {
    const parsed = parseCodexAgentToml(API_DESIGNER);
    if (!parsed) throw new Error("parse failed");
    const emitted = emitCodexAgentToml(parsed);
    const again = parseCodexAgentToml(emitted);
    expect(again).toEqual(parsed);
  });
});

describe("parseMarkdownAgent", () => {
  it("splits frontmatter and body", () => {
    const agent = parseMarkdownAgent(CLAUDE_AGENT, "ignored.md");
    expect(agent?.name).toBe("release-reviewer");
    expect(agent?.instructions.trim()).toBe("# Release Reviewer");
    expect(agent?.metadata.reasoning_effort).toBe("high");
    expect(agent?.metadata.wire_format).toBe("markdown-frontmatter");
  });
});

describe("emitMarkdownAgent", () => {
  it("cursor flavor maps sandbox to readonly", () => {
    const agent = parseCodexAgentToml(`name = "x"
description = "d"
sandbox_mode = "read-only"
developer_instructions = "body"
`);
    if (!agent) throw new Error("parse failed");
    const md = emitMarkdownAgent(agent, "cursor");
    expect(md).toContain("readonly: true");
    expect(md).toContain("body");
  });
});
