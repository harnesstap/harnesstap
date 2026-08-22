import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  formatResourceDeleteAttachers,
  resourceCanRemoveFromActiveProfile,
  type ResourceAttachers,
} from "../../apps/desktop/src/lib/resource-delete.ts";

const empty: ResourceAttachers = {
  profiles: [],
  plugins: [],
  active_profile: null,
  in_active_profile: false,
};

const detailSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceDetailBody.tsx",
  ),
  "utf8",
);
const confirmSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ConfirmDialog.tsx"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("formatResourceDeleteAttachers", () => {
  test("lists attached profiles and plugins", () => {
    const copy = formatResourceDeleteAttachers({
      profiles: ["work", "default"],
      plugins: ["formatter"],
      active_profile: "work",
      in_active_profile: true,
    });
    expect(copy.profilesLine).toBe("Profiles: work, default");
    expect(copy.pluginsLine).toBe("Plugins: formatter");
    expect(copy.emptyLine).toBeNull();
  });

  test("says when nothing attaches the resource", () => {
    const copy = formatResourceDeleteAttachers(empty);
    expect(copy.profilesLine).toBeNull();
    expect(copy.pluginsLine).toBeNull();
    expect(copy.emptyLine).toBe("No profiles or plugins currently attach this resource.");
  });
});

describe("resourceCanRemoveFromActiveProfile", () => {
  test("is true only when the resource is enabled on the active profile", () => {
    expect(
      resourceCanRemoveFromActiveProfile({
        ...empty,
        active_profile: "work",
        in_active_profile: true,
      }),
    ).toBe(true);
    expect(
      resourceCanRemoveFromActiveProfile({
        ...empty,
        active_profile: "work",
        in_active_profile: false,
      }),
    ).toBe(false);
    expect(resourceCanRemoveFromActiveProfile(empty)).toBe(false);
  });
});

describe("resource delete confirm chrome", () => {
  test("lists attachers and offers Remove from active profile", () => {
    expect(detailSource).toContain("formatResourceDeleteAttachers");
    expect(detailSource).toContain("resourceCanRemoveFromActiveProfile");
    expect(detailSource).toContain("Remove from active profile");
    expect(detailSource).toContain("secondaryLabel={canRemoveFromActive");
    expect(detailSource).toContain("removeProfileResource");
    expect(confirmSource).toContain("secondaryLabel");
    expect(confirmSource).toContain("onSecondary");
  });

  test("documents listing attachers on resource delete", () => {
    expect(designSource).toContain("list profiles and plugins that still attach");
    expect(designSource).toContain("Remove from active profile");
  });
});
