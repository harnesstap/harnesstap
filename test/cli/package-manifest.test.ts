import pkg from "../../package.json";
import { describe, expect, it } from "vitest";

describe("published CLI bins", () => {
  it("uses the toolkit package description", () => {
    expect(pkg.description).toBe(
      "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
    );
  });

  it("publishes both harnessdeck and hd", () => {
    expect(pkg.bin).toMatchObject({
      harnessdeck: "./dist/index.js",
      hd: "./dist/index.js",
    });
  });
});
