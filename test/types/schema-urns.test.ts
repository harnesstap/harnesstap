import { describe, expect, it } from "bun:test";
import {
  BUNDLE_SCHEMA,
  DECK_SCHEMA,
  LAYER_SCHEMA,
  PROJECT_SCHEMA,
  RESOURCE_SCHEMA,
} from "../../src/types.js";

describe("schema URNs", () => {
  it("uses harnesstap brand prefix", () => {
    expect(DECK_SCHEMA).toBe("urn:harnesstap:deck:v1");
    expect(PROJECT_SCHEMA).toBe("urn:harnesstap:project:v1");
    expect(BUNDLE_SCHEMA).toBe("urn:harnesstap:bundle:v1");
    expect(LAYER_SCHEMA).toBe("urn:harnesstap:layer:v1");
    expect(RESOURCE_SCHEMA).toBe("urn:harnesstap:resource:v1");
  });
});
