import { describe, expect, it } from "bun:test";
import { profileDependencyForMember } from "../../apps/desktop/src/lib/composition-membership.ts";

const dependencies = [
  { dependency_name: "feature-dev", resource_id: "res-feature-dev" },
  { dependency_name: "superpowers", resource_id: "res-superpowers" },
];
const plugins = [
  { id: "plugin-superpowers", name: "superpowers" },
  { id: "plugin-other", name: "other" },
];

describe("profileDependencyForMember", () => {
  it("maps a dependency row missing from the Library to its dependency name", () => {
    expect(profileDependencyForMember("res-feature-dev", dependencies, plugins)).toBe("feature-dev");
  });

  it("maps a Library plugin head to the dependency it satisfies", () => {
    expect(profileDependencyForMember("plugin-superpowers", dependencies, plugins)).toBe("superpowers");
  });

  it("returns null for rows that are not dependencies of the profile", () => {
    expect(profileDependencyForMember("plugin-other", dependencies, plugins)).toBeNull();
    expect(profileDependencyForMember("skill-1", dependencies, plugins)).toBeNull();
  });
});
