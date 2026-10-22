import { describe, expect, it } from "bun:test";
import { gitDependencyPinIssue } from "../../src/services/git-dependency-pin-check.ts";
import { pluginMetadataCheck } from "../../src/services/plugin-doctor/checks/plugin-metadata.ts";
import type { PluginDoctorContext } from "../../src/services/plugin-doctor/plugin-doctor.types.ts";

const REF = "git@github.com:Yuan1z0825/nature-skills.git";

function metadataResults(constraint: string) {
  const context = {
    plugin: { name: "p" },
    plugins: [{ name: "nature-skills", source_kind: "git", ref: REF, version_constraint: constraint }],
  } as unknown as PluginDoctorContext;
  return pluginMetadataCheck.run(context);
}

describe("git dependency pins in doctor (#500)", () => {
  it("accepts a commit, branch, tag and semver range", () => {
    for (const constraint of ["f8797fe", "main", "#main", "ref:v1.0.0", "1.0.0", "^1.0.0"]) {
      expect(metadataResults(constraint)).toEqual([]);
      expect(gitDependencyPinIssue(REF, constraint)).toBeNull();
    }
  });

  it("warns when a git dependency is not pinned", () => {
    for (const constraint of ["", "latest", "*"]) {
      const results = metadataResults(constraint);
      expect(results).toHaveLength(1);
      expect(results[0]?.severity).toBe("warn");
      expect(results[0]?.message).toContain("tracks the default branch HEAD");
    }
  });

  it("reports a constraint git cannot use as an error", () => {
    const results = metadataResults("bad..ref");
    expect(results).toHaveLength(1);
    expect(results[0]?.severity).toBe("error");
    expect(results[0]?.message).toContain("Invalid git dependency constraint: bad..ref");
  });

  it("does not ask a git URL for a marketplace", () => {
    const results = metadataResults("f8797fe");
    expect(results.some((result) => result.message.includes("must include marketplace"))).toBe(false);
  });
});
