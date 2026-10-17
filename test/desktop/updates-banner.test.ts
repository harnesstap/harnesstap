import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { UpdateRow } from "../../apps/desktop/src/lib/api/updates.ts";
import { profilesWithUpdates, updatesBanner } from "../../apps/desktop/src/lib/updates-banner.ts";

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
  it("is absent when nothing is pending", () => {
    expect(updatesBanner([])).toBeNull();
    expect(updatesBanner([row({ plugin_name: "a", pending: false })])).toBeNull();
  });

  it("counts updates and offers Update all, with Not now at the offered versions", () => {
    const model = updatesBanner([
      row({ plugin_name: "a" }),
      row({ plugin_name: "b", kind: "extends", latest_in_range: "1.3.0" }),
      row({ plugin_name: "c", status: "major", latest_in_range: "1.0.0", latest_major: "2.0.0" }),
    ]);
    expect(model).toEqual({
      message: "2 updates available. 1 major version available, never installed automatically.",
      canUpdateAll: true,
      dismiss: [
        { plugin: "a", version: "1.2.0" },
        { plugin: "b", version: "1.3.0" },
        { plugin: "c", version: "2.0.0" },
      ],
    });
  });

  it("names a separate copy and does not offer Update all for it", () => {
    const model = updatesBanner([row({ plugin_name: "backend-copy", kind: "fork", latest_in_range: "1.1.0" })]);
    expect(model?.message).toBe("backend-copy: upstream has 1.1.0 (you copied 1.0.0).");
    expect(model?.canUpdateAll).toBe(false);
  });

  it("puts the rail dot on profiles that use a plugin with an update, not on majors", () => {
    const dots = profilesWithUpdates([
      row({ plugin_name: "a", profiles: ["team", "solo"] }),
      row({ plugin_name: "c", status: "major", profiles: ["ops"] }),
      row({ plugin_name: "d", pending: false, profiles: ["old"] }),
    ]);
    expect([...dots].sort()).toEqual(["solo", "team"]);
  });

  it("is wired once in the Global view with Update all and Not now, and the rail renders the dot", () => {
    const workspace = src("components/shell/ScopeWorkspace.tsx");
    expect(workspace).toContain('scope === "global" ? (\n            <UpdatesBanner');
    const banner = src("components/shell/UpdatesBanner.tsx");
    expect(banner).toContain("Update all");
    expect(banner).toContain("Not now");
    expect(src("components/shell/ProfilesRail.tsx")).toContain("profile-update-dot");
  });

  it("keeps the visual baselines off the network", () => {
    const demo = readFileSync(join(import.meta.dir, "../../apps/desktop/scripts/demo-home.sh"), "utf8");
    expect(demo).toContain("HARNESSTAP_UPDATE_CHECK=off");
  });
});
