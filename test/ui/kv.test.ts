import { describe, expect, it } from "vitest";
import { renderKv } from "../../src/ui/kv.ts";

describe("ui kv", () => {
  it("pads the key to 20 characters by default", () => {
    const output = renderKv("Name", "my-preset");
    // "Name" is 4 chars; padded to 20 = 4 + 16 trailing spaces
    expect(output).toContain(`Name${" ".repeat(16)}`);
  });

  it("accepts a custom keyWidth", () => {
    const output = renderKv("Tag", "core", 10);
    // "Tag" is 3 chars; padded to 10 = 3 + 7 trailing spaces
    expect(output).toContain(`Tag${" ".repeat(7)}`);
  });

  it("includes the value after the key", () => {
    const output = renderKv("Status", "active");
    expect(output).toContain("active");
  });
});
