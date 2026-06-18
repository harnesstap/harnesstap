import { describe, expect, it } from "bun:test";
import { isProfileLayer } from "../../src/constants/profile.ts";

describe("profile constants", () => {
  it("recognizes profile-tagged layers", () => {
    expect(isProfileLayer({ tags: ["profile"] })).toBe(true);
    expect(isProfileLayer({ tags: ["local", "profile"] })).toBe(true);
    expect(isProfileLayer({ tags: ["local"] })).toBe(false);
  });
});
