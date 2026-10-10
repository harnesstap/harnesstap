import { describe, expect, it } from "bun:test";
import { filterInstructionsForTargetPath } from "../../src/services/instruction-target.ts";
import type { Resource } from "../../src/types.ts";

function instruction(name: string, source: string): Resource {
  return {
    id: name,
    type: "instruction",
    name,
    description: "",
    content: `# ${name}`,
    metadata: {},
    source,
    namespace: "",
    origin_kind: "local_snapshot",
    origin_ref: "",
    content_hash: "",
    content_blob_ref: "",
    created_at: "",
    updated_at: "",
  };
}

describe("filterInstructionsForTargetPath", () => {
  const resources = [
    instruction("claude", "~/.claude/CLAUDE.md"),
    instruction("codex", "~/.codex/AGENTS.md"),
    instruction("shared-home", "~/.agents/AGENTS.md"),
    instruction("project-agents", "AGENTS.md"),
    instruction("project-claude", "CLAUDE.md"),
    instruction("portable", "manual"),
    instruction("empty-source", ""),
  ];

  it("keeps Claude instructions on CLAUDE.md and drops other harness files", () => {
    expect(
      filterInstructionsForTargetPath(resources, [".claude/CLAUDE.md", "CLAUDE.md"]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude", "project-agents", "project-claude", "portable", "empty-source"]);
  });

  it("keeps Codex instructions on AGENTS.md and drops Claude and shared home files", () => {
    expect(
      filterInstructionsForTargetPath(resources, [".codex/AGENTS.md", "AGENTS.md"]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["codex", "project-agents", "project-claude", "portable", "empty-source"]);
  });

  it("does not emit ~/.agents/AGENTS.md onto Cursor AGENTS.md or .cursorrules", () => {
    expect(
      filterInstructionsForTargetPath(resources, ["AGENTS.md", ".cursorrules"]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["project-agents", "project-claude", "portable", "empty-source"]);
  });

  it("keeps shared home instructions only on that path", () => {
    expect(
      filterInstructionsForTargetPath(resources, ["~/.agents/AGENTS.md"]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["shared-home", "portable", "empty-source"]);
  });
});
