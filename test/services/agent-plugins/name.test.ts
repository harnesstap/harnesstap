import { describe, expect, it } from "bun:test";
import { isValidApName, slugifyApName } from "../../../src/services/agent-plugins/name.ts";

describe("isValidApName", () => {
  it("accepts conforming names", () => {
    expect(isValidApName("my-plugin")).toBe(true);
    expect(isValidApName("a")).toBe(true);
    expect(isValidApName("web.search-v2")).toBe(true);
    expect(isValidApName("a".repeat(64))).toBe(true);
  });

  it("rejects empty and over-long names", () => {
    expect(isValidApName("")).toBe(false);
    expect(isValidApName("a".repeat(65))).toBe(false);
  });

  it("rejects uppercase and disallowed characters", () => {
    expect(isValidApName("MyPlugin")).toBe(false);
    expect(isValidApName("my_plugin")).toBe(false);
    expect(isValidApName("my plugin")).toBe(false);
    expect(isValidApName("my/plugin")).toBe(false);
  });

  it("rejects non-alphanumeric first or last characters", () => {
    expect(isValidApName("-plugin")).toBe(false);
    expect(isValidApName("plugin-")).toBe(false);
    expect(isValidApName(".plugin")).toBe(false);
    expect(isValidApName("plugin.")).toBe(false);
  });

  it("rejects doubled separators", () => {
    expect(isValidApName("my--plugin")).toBe(false);
    expect(isValidApName("my..plugin")).toBe(false);
  });
});

describe("slugifyApName", () => {
  it("lowercases and replaces disallowed characters", () => {
    expect(slugifyApName("My Plugin")).toBe("my-plugin");
    expect(slugifyApName("Team_Standards")).toBe("team-standards");
    expect(slugifyApName("Acme // Base")).toBe("acme-base");
  });

  it("collapses doubled separators", () => {
    expect(slugifyApName("a---b")).toBe("a-b");
    expect(slugifyApName("a...b")).toBe("a.b");
  });

  it("trims non-alphanumeric edges", () => {
    expect(slugifyApName("-lead-")).toBe("lead");
    expect(slugifyApName("...x...")).toBe("x");
  });

  it("truncates to 64 characters without a trailing separator", () => {
    const slug = slugifyApName(`${"a".repeat(63)}-b`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back when nothing is usable", () => {
    expect(slugifyApName("___")).toBe("plugin");
    expect(slugifyApName("")).toBe("plugin");
  });

  it("always produces a valid AP name", () => {
    for (const input of ["My Plugin", "___", "a".repeat(200), "-x-", "Ünïcødé"]) {
      expect(isValidApName(slugifyApName(input))).toBe(true);
    }
  });
});
