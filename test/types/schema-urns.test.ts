import { describe, expect, it } from "bun:test";
import { AP_PACKAGE_SCHEMA } from "../../src/services/agent-plugins/files.ts";
import { HT_EXTENSION_SCHEMA } from "../../src/services/agent-plugins/manifest.ts";
import { environmentToTomlDocument } from "../../src/services/toml/environment-document.ts";
import { DECK_SCHEMA } from "../../src/types.js";
import * as types from "../../src/types.js";

describe("schema URNs", () => {
  it("keeps surviving local and package schemas", () => {
    expect(AP_PACKAGE_SCHEMA).toBe("urn:harnesstap:ap-package:v1");
    expect(HT_EXTENSION_SCHEMA).toBe("urn:harnesstap:ap-extension:v1");
    expect(DECK_SCHEMA).toBe("urn:harnesstap:deck:v1");
  });

  it("keeps environment documents as schema-less TOML tables", () => {
    expect(environmentToTomlDocument({ name: "work", values: { A: "1" } })).toEqual({
      name: "work",
      values: { A: "1" },
    });
  });

  it("retires layer and resource transport schema constants", () => {
    expect("PLUGIN_SCHEMA" in types).toBe(false);
    expect("RESOURCE_SCHEMA" in types).toBe(false);
    expect("BUNDLE_SCHEMA" in types).toBe(false);
    expect("LAYER_SCHEMA" in types).toBe(false);
    const serialized = JSON.stringify(types);
    expect(serialized).not.toContain("urn:harnesstap:layer:v1");
    expect(serialized).not.toContain("urn:harnesstap:resource:v1");
  });
});
