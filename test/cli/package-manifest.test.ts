import pkg from "../../package.json";
import { describe, expect, it } from "bun:test";

describe("published CLI bins", () => {
  it("uses the toolkit package description", () => {
    expect(pkg.description).toBe(
      "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
    );
  });

  it("publishes both harnesstap and ht", () => {
    expect(pkg.bin).toMatchObject({
      harnesstap: "./dist/bin.js",
      ht: "./dist/bin.js",
    });
  });

  it("declares the supported Node engine floor", () => {
    expect(pkg.engines.node).toBe(">=22.12.0");
  });
});
