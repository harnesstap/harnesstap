import { describe, expect, it } from "bun:test";
import {
  parseApmDependencyEntry,
  parseApmDependencyString,
} from "../../src/services/apm-dependencies.ts";

describe("parseApmDependency", () => {
  it("parses owner/repo shorthand and #ref", () => {
    const parsed = parseApmDependencyString("acme/widgets#v1.2.3");
    expect(parsed.sourceKind).toBe("git");
    expect(parsed.name).toBe("widgets");
    expect(parsed.originRef).toBe("https://github.com/acme/widgets.git");
    expect(parsed.ref).toBe("v1.2.3");
  });

  it("parses https, ssh, and file git URLs", () => {
    expect(parseApmDependencyString("https://github.com/acme/widgets.git").sourceKind).toBe("git");
    expect(parseApmDependencyString("git@github.com:acme/widgets.git").sourceKind).toBe("git");
    expect(parseApmDependencyString("ssh://git@github.com/acme/widgets.git").sourceKind).toBe("git");
    expect(parseApmDependencyString("file:///tmp/widgets.git").sourceKind).toBe("git");
    expect(parseApmDependencyString("git+https://github.com/acme/widgets.git").originRef).toBe(
      "https://github.com/acme/widgets.git",
    );
  });

  it("keeps object-form path off the clone URL", () => {
    const parsed = parseApmDependencyEntry({
      git: "acme/widgets",
      ref: "^1.0.0",
      path: "packages/ship",
    });
    expect(parsed.sourceKind).toBe("git");
    expect(parsed.originRef).toBe("https://github.com/acme/widgets.git");
    expect(parsed.ref).toBe("^1.0.0");
    expect(parsed.path).toBe("packages/ship");
  });
});
