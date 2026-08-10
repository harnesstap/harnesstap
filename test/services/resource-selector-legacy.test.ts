import { describe, expect, it } from "bun:test";
import {
  parseResourceSelector,
  takeSelectorDeprecations,
} from "../../src/services/resource-selector.ts";

describe("legacy selector spellings", () => {
  it("maps plugin_pin: to plugin: and records a deprecation", () => {
    takeSelectorDeprecations();
    expect(parseResourceSelector("plugin_pin:web-search@anthropics")).toMatchObject({
      type: "plugin",
      name: "web-search",
      namespace: "anthropics",
    });
    expect(takeSelectorDeprecations()).toEqual([
      "plugin_pin: is now plugin: — use plugin:web-search@anthropics",
    ]);
  });

  it("records nothing for a current spelling", () => {
    takeSelectorDeprecations();
    parseResourceSelector("plugin:base");
    expect(takeSelectorDeprecations()).toEqual([]);
  });

  it("drains the buffer so warnings are emitted once", () => {
    takeSelectorDeprecations();
    parseResourceSelector("plugin_pin:base@mp");
    expect(takeSelectorDeprecations()).toHaveLength(1);
    expect(takeSelectorDeprecations()).toEqual([]);
  });
});
