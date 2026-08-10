import { describe, expect, it } from "bun:test";
import { RESOURCE_CLASSES, resourceClass } from "../../src/platforms/registry.ts";
import { MATERIAL_RESOURCE_TYPES } from "../../src/types.ts";

describe("resource classes", () => {
  it("classifies every material resource type exactly once", () => {
    for (const type of MATERIAL_RESOURCE_TYPES) {
      expect(RESOURCE_CLASSES[type]).toBeDefined();
    }
    expect(Object.keys(RESOURCE_CLASSES).sort()).toEqual(
      [...MATERIAL_RESOURCE_TYPES].sort(),
    );
  });

  it("marks name-keyed collection types as set-like", () => {
    expect(resourceClass("skill")).toBe("set");
    expect(resourceClass("rule")).toBe("set");
    expect(resourceClass("agent")).toBe("set");
    expect(resourceClass("command")).toBe("set");
    expect(resourceClass("hook")).toBe("set");
    expect(resourceClass("mcp_server")).toBe("set");
  });

  it("marks behavior- and security-bearing types as singleton", () => {
    expect(resourceClass("instruction")).toBe("singleton");
    expect(resourceClass("model_config")).toBe("singleton");
    expect(resourceClass("permission")).toBe("singleton");
    expect(resourceClass("env_var")).toBe("singleton");
  });
});
