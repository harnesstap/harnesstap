import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { riskyRemovalPaths } from "../../apps/desktop/src/lib/ui-copy.ts";
import { handleProfileApplyPreview } from "../../src/agent/profile-apply-preview-handlers.ts";
import { handleProfileAttach } from "../../src/agent/profile-edit-handlers.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import type { PlannedRemovals } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const TOKEN = "test-token";

function authJsonRequest(path: string, body: unknown): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Desktop Add to profile on an in-library plugin", () => {
  it("does not trigger the Some files will not be removed dialog", async () => {
    const context = await createInitializedTestContext("agent-add-to-profile-preview");
    try {
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"] });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "docs",
          description: "",
          content: "",
          metadata: { command: "docs-mcp" },
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", { conflictPolicy: "replace" });
      for (const relative of [".claude.json", ".cursor/mcp.json"]) {
        const path = join(context.homeDir, relative);
        const value = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
        value.harnessWroteThis = true;
        writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
      }

      const plugin = createPlugin({ name: "confluence-pages" });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "skill",
          name: "pages",
          description: "Confluence pages",
          content: "---\nname: pages\ndescription: Confluence pages\n---\nbody\n",
          metadata: {},
          source: "manual",
        }).id,
      );

      const attached = await handleProfileAttach(
        authJsonRequest("/v1/profiles/work/attachments", { pluginId: plugin.id }),
        TOKEN,
        "work",
      );
      expect(attached.status).toBe(200);

      const response = await handleProfileApplyPreview(
        authJsonRequest("/v1/profiles/apply-preview", { profile: "work", scope: "home" }),
        TOKEN,
      );
      expect(response.status).toBe(200);
      const preview = (await response.json()) as { removals: PlannedRemovals };
      expect(riskyRemovalPaths(preview.removals)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
