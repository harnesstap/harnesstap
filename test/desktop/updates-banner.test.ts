import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { UpdateRow } from "../../apps/desktop/src/lib/api/updates.ts";
import { handledKey, profileUpdatesBanner, profilesWithUpdates } from "../../apps/desktop/src/lib/updates-banner.ts";

function row(partial: Partial<UpdateRow> & Pick<UpdateRow, "plugin_name">): UpdateRow {
  return {
    ref: `acme/default/${partial.plugin_name}@^1.0.0`,
    local_version: "1.0.0",
    latest_in_range: "1.2.0",
    latest_major: "",
    status: "update",
    checked_at: "now",
    dismissed_version: "",
    message: "",
    kind: "catalog",
    pending: true,
    profiles: [],
    ...partial,
  };
}

const src = (path: string) => readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

describe("updates banner", () => {
  it("is absent when nothing is pending or no profile is open", () => {
    expect(profileUpdatesBanner([], "team")).toBeNull();
    expect(profileUpdatesBanner([row({ plugin_name: "a", pending: false, profiles: ["team"] })], "team")).toBeNull();
    expect(profileUpdatesBanner([row({ plugin_name: "a", profiles: ["team"] })], null)).toBeNull();
  });

  it("only shows on the affected profile's page", () => {
    const rows = [row({ plugin_name: "acme-lint", profiles: ["team"] })];
    expect(profileUpdatesBanner(rows, "solo")).toBeNull();
    expect(profileUpdatesBanner(rows, "team")).toEqual({
      message: "acme-lint: 1.2.0 is available (you have 1.0.0).",
      plugins: ["acme-lint"],
      dismiss: [{ plugin: "acme-lint", version: "1.2.0" }],
    });
  });

  it("covers the profile itself when it is the parent with an update", () => {
    const rows = [row({ plugin_name: "backend", kind: "extends", latest_in_range: "1.1.0" })];
    expect(profileUpdatesBanner(rows, "backend")?.message).toBe("backend: 1.1.0 is available (you have 1.0.0).");
  });

  it("lists several updates in one sentence", () => {
    const rows = [
      row({ plugin_name: "a", profiles: ["team"] }),
      row({ plugin_name: "b", profiles: ["team"], latest_in_range: "1.3.0" }),
    ];
    expect(profileUpdatesBanner(rows, "team")?.message).toBe("2 updates are available: a, b.");
  });

  it("leaves majors and separate copies to the bell", () => {
    const rows = [
      row({ plugin_name: "c", status: "major", latest_in_range: "1.0.0", latest_major: "2.0.0", profiles: ["team"] }),
      row({ plugin_name: "backend-copy", kind: "fork", latest_in_range: "1.1.0" }),
    ];
    expect(profileUpdatesBanner(rows, "team")).toBeNull();
    expect(profileUpdatesBanner(rows, "backend-copy")).toBeNull();
  });

  it("clears once the offered version was updated", () => {
    const rows = [row({ plugin_name: "a", profiles: ["team"] })];
    expect(profileUpdatesBanner(rows, "team", new Set([handledKey(rows[0]!)]))).toBeNull();
  });

  it("puts the rail badge on profiles that use a plugin with an update, not on majors or copies", () => {
    const dots = profilesWithUpdates([
      row({ plugin_name: "a", profiles: ["team", "solo"] }),
      row({ plugin_name: "c", status: "major", profiles: ["ops"] }),
      row({ plugin_name: "d", pending: false, profiles: ["old"] }),
      row({ plugin_name: "backend-copy", kind: "fork", profiles: ["backend-copy"] }),
    ]);
    expect([...dots].sort()).toEqual(["solo", "team"]);
  });

  it("is wired on the selected profile's page with Update and Dismiss, and the rail renders the badge", () => {
    const workspace = src("components/shell/ScopeWorkspace.tsx");
    expect(workspace).toContain("profileName={selectedProfile}");
    expect(workspace).not.toContain('scope === "global" ? (\n            <UpdatesBanner');
    const banner = src("components/shell/UpdatesBanner.tsx");
    expect(banner).toContain('tone="neutral"');
    expect(banner).toContain("onDismiss=");
    expect(banner).not.toContain("Update all");
    const rail = src("components/shell/ProfilesRail.tsx");
    expect(rail).toContain("profile-update-slot");
    expect(rail).toContain('content="Update available"');
  });

  it("keeps the visual baselines off the network", () => {
    const demo = readFileSync(join(import.meta.dir, "../../apps/desktop/scripts/demo-home.sh"), "utf8");
    expect(demo).toContain("HARNESSTAP_UPDATE_CHECK=off");
  });
});
