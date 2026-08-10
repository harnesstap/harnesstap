import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { attachPluginPinToPlugin } from "../../src/services/plugin-composition.ts";
import {
  buildHarnessPluginRows,
  computeGlobalProfilePanelStatus,
} from "../../src/services/global-profile-status-panel.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("global-profile-drift service", () => {
  it("reports pending apply when active profile was never applied globally", async () => {
    const context = await createInitializedTestContext("global-profile-drift-pending");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });

      expect(status.active_profile).toBe("work");
      expect(status.applied).toBe(false);
      expect(status.has_drift).toBe(true);
      expect(status.panel.status).toBe("red");
      expect(status.panel.reasons).toContain("profile_not_applied");
      expect(status.depth).toBe("full");
      expect(status.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await context.cleanup();
    }
  });

  it("reports in sync after profile use", async () => {
    const context = await createInitializedTestContext("global-profile-drift-synced");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({
        harness: "claude-code",
        depth: "full",
      });

      expect(status.applied).toBe(true);
      expect(status.stack_in_sync).toBe(true);
      expect(status.has_drift).toBe(false);
      expect(status.panel.status).toBe("green");
      expect(status.harnesses["claude-code"]?.plugins).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("marks fast depth as yellow with empty harness maps", async () => {
    const context = await createInitializedTestContext("global-profile-drift-fast");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({
        harness: "claude-code",
        depth: "fast",
      });

      expect(status.depth).toBe("fast");
      expect(status.panel.status).toBe("yellow");
      expect(status.panel.reasons).toContain("fast_depth");
      expect(status.harnesses["claude-code"]?.plugins).toEqual([]);
      expect(status.harnesses.cursor?.mcp).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("reports red when declared plugin pins are missing", async () => {
    const context = await createInitializedTestContext("global-profile-drift-missing-plugin");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      attachPluginPinToPlugin(plugin.id, "demo@demo-market", "1.0.0");
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({
        harness: "claude-code",
        depth: "full",
      });

      expect(status.panel.status).toBe("red");
      expect(status.panel.reasons).toContain("missing_plugins");
      expect(status.harnesses["claude-code"]?.plugins).toEqual([
        { id: "demo@demo-market", state: "missing" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("allows green panel when only extra plugins are installed", () => {
    const rows = buildHarnessPluginRows([], fixtureHome);
    expect(rows.some((row) => row.state === "extra")).toBe(true);

    const panel = computeGlobalProfilePanelStatus({
      depth: "full",
      applied: true,
      activeProfile: "work",
      stackInSync: true,
      ownedDriftCount: 0,
      nonOwnedDriftCount: 0,
      missingPluginCount: 0,
      missingMcpCount: 0,
    });

    expect(panel.status).toBe("green");
    expect(panel.reasons).toEqual([]);
  });

  it("reports red for owned-path drift and yellow for non-owned drift", () => {
    const owned = computeGlobalProfilePanelStatus({
      depth: "full",
      applied: true,
      activeProfile: "work",
      stackInSync: true,
      ownedDriftCount: 1,
      nonOwnedDriftCount: 0,
      missingPluginCount: 0,
      missingMcpCount: 0,
    });
    expect(owned.status).toBe("red");
    expect(owned.reasons).toContain("owned_path_drift");

    const nonOwned = computeGlobalProfilePanelStatus({
      depth: "full",
      applied: true,
      activeProfile: "work",
      stackInSync: true,
      ownedDriftCount: 0,
      nonOwnedDriftCount: 1,
      missingPluginCount: 0,
      missingMcpCount: 0,
    });
    expect(nonOwned.status).toBe("yellow");
    expect(nonOwned.reasons).toContain("non_owned_drift");
  });

  it("reports missing MCP servers for cursor harness", async () => {
    const context = await createInitializedTestContext("global-profile-drift-mcp");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      await applyProfilePlugin("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });

      const mcp = createResource({
        type: "mcp_server",
        name: "context7",
        description: "",
        content: "",
        metadata: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
        },
        source: "manual",
      });
      addResourceToPlugin(plugin.id, mcp.id);
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({
        harness: "cursor",
        depth: "full",
      });

      expect(status.panel.status).toBe("red");
      expect(status.panel.reasons).toContain("missing_mcp");
      expect(status.harnesses.cursor?.mcp).toEqual([
        { name: "context7", state: "missing" },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
