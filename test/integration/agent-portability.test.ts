import { describe, expect, it } from "bun:test";
import { generateFiles } from "../../src/services/applier.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

describe("agent portability", () => {
  it("applies the same agent resource to Codex, Claude, and Cursor", async () => {
    const context = await createInitializedTestContext("agent-portability");

    try {
      const agent = makeResource({
        type: "agent",
        name: "api-designer",
        description: "API contract design",
        content: "Design long-lived contracts.",
        metadata: {
          model: "gpt-5.4",
          reasoning_effort: "high",
          sandbox_mode: "read-only",
        },
      });

      const codex = await generateFiles([agent], ["codex"], context.projectDir);
      expect(
        codex[0]?.files.find((file) => file.path.endsWith("api-designer.toml"))?.content,
      ).toContain("developer_instructions");

      const claude = await generateFiles([agent], ["claude-code"], context.projectDir);
      expect(
        claude[0]?.files.find((file) => file.path.includes(".claude/agents/"))?.content,
      ).toContain("description:");

      const cursor = await generateFiles([agent], ["cursor"], context.projectDir);
      expect(
        cursor[0]?.files.find((file) => file.path.includes(".cursor/agents/"))?.content,
      ).toContain("readonly: true");
    } finally {
      await context.cleanup();
    }
  });
});
