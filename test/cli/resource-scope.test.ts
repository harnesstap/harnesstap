import { describe, expect, it } from "bun:test";
import { createResource } from "../../src/models/resource.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginResourceHarnessScope,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("ht resource scope", () => {
  it("adds harness ids through formatCommand-shaped --add", async () => {
    const context = await createTestContext("cli-resource-scope-add");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const resource = createResource({
        type: "mcp_server",
        name: "filesystem",
        description: "fs",
        content: "",
        metadata: { transport: "stdio", command: "npx" },
        source: "manual",
      });
      addResourceToPlugin(profile.id, resource.id, {
        kind: "subset",
        harnesses: ["claude-code"],
      });

      const result = await runCli([
        "resource",
        "scope",
        "filesystem",
        "--add",
        "cursor,codex",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Only on");
      const scope = getPluginResourceHarnessScope(profile.id, resource.id);
      expect(scope.kind).toBe("subset");
      if (scope.kind === "subset") {
        expect(scope.harnesses).toEqual(["claude-code", "codex", "cursor"]);
      }
    } finally {
      await context.cleanup();
    }
  });
});
