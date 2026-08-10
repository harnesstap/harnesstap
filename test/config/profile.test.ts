import { describe, expect, it } from "bun:test";
import { isProfilePlugin } from "../../src/constants/profile.ts";

describe("profile constants", () => {
  it("recognizes profile-tagged plugins", () => {
    expect(isProfilePlugin({ tags: ["profile"] })).toBe(true);
    expect(isProfilePlugin({ tags: ["local", "profile"] })).toBe(true);
    expect(isProfilePlugin({ tags: ["local"] })).toBe(false);
  });
});
