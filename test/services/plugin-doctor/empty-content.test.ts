import { describe, expect, it } from "bun:test";
import {
  addResourceToPlugin,
  createPlugin,
} from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { runPluginDoctor } from "../../../src/services/plugin-doctor.ts";
import { validatePlugin } from "../../../src/services/plugin-validate.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { makeResourceInput } from "../../helpers/resources.ts";

describe("empty-content doctor check", () => {
  it("does not warn on healthy mcp_server and permission with empty content", async () => {
    const context = await createInitializedTestContext("doctor-meta-ok");
    try {
      const plugin = createPlugin({ name: "meta-ok" });
      const mcp = createResource(
        makeResourceInput({
          type: "mcp_server",
          name: "devel",
          content: "",
          metadata: { transport: "stdio", command: "npx", args: ["-y", "devel"] },
        }),
      );
      const permission = createResource(
        makeResourceInput({
          type: "permission",
          name: "allow-Bash(jk:*)",
          content: "",
          metadata: { action: "allow", pattern: "Bash(jk:*)" },
        }),
      );
      addResourceToPlugin(plugin.id, mcp.id);
      addResourceToPlugin(plugin.id, permission.id);

      const report = runPluginDoctor({ nameOrId: "meta-ok" });
      expect(report.results.filter((row) => row.check === "empty-content")).toEqual([]);
      expect(
        validatePlugin("meta-ok").issues.filter((issue) => issue.code === "empty_content"),
      ).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("warns when mcp_server metadata has no command or url", async () => {
    const context = await createInitializedTestContext("doctor-meta-empty");
    try {
      const plugin = createPlugin({ name: "meta-empty" });
      const mcp = createResource(
        makeResourceInput({
          type: "mcp_server",
          name: "broken",
          content: "",
          metadata: { transport: "stdio" },
        }),
      );
      addResourceToPlugin(plugin.id, mcp.id);

      const report = runPluginDoctor({ nameOrId: "meta-empty" });
      expect(report.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            check: "empty-content",
            severity: "warn",
            message: "Resource has empty definition: mcp_server:broken",
          }),
        ]),
      );
      expect(report.valid).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
