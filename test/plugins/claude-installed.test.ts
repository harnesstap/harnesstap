import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { listInstalledPluginPinCreateInputs } from "../../src/plugins/claude-installed.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("listInstalledPluginPinCreateInputs", () => {
  it("imports unique plugin pins from installed_plugins.json", () => {
    const pins = listInstalledPluginPinCreateInputs(fixtureHome);

    expect(pins.map((pin) => pin.origin_ref)).toEqual([
      "demo@demo-market",
      "formatter@acme-marketplace",
      "security@claude-code-marketplace",
      "user-only@demo",
    ]);

    const demo = pins.find((pin) => pin.origin_ref === "demo@demo-market");
    expect(demo).toMatchObject({
      type: "plugin",
      name: "demo",
      namespace: "demo-market",
      origin_kind: "marketplace_link",
      source: "~/.claude/plugins/installed_plugins.json",
    });
    expect(demo?.metadata).toMatchObject({
      source_kind: "marketplace",
      marketplace_name: "demo-market",
      sync_status: "never_synced",
      portable: "reference",
    });
  });
});
