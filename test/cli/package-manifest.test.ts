import pkg from "../../package.json";
import { describe, expect, it } from "vitest";

describe("published CLI bins", () => {
  it("publishes both harnessdeck and hd", () => {
    expect(pkg.bin).toMatchObject({
      harnessdeck: "./dist/index.js",
      hd: "./dist/index.js",
    });
  });
});
