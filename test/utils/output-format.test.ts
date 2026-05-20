import { describe, it, expect } from "vitest";
import { parseOutputFormat } from "../../src/utils/output-format.js";

describe("parseOutputFormat", () => {
  it("defaults to human", () => {
    expect(parseOutputFormat(undefined)).toBe("human");
  });

  it("accepts json", () => {
    expect(parseOutputFormat("json")).toBe("json");
  });

  it("rejects invalid format", () => {
    expect(() => parseOutputFormat("xml")).toThrow(/Invalid --format/);
  });
});
