import { describe, expect, it } from "vitest";
import { renderPanel } from "../../src/ui/panel.ts";

describe("ui panel", () => {
  it("renders title and key-value rows", () => {
    const output = renderPanel("Details", [
      { key: "Name", value: "my-preset" },
      { key: "Tags", value: "core, shared" },
    ]);
    expect(output).toContain("Details");
    expect(output).toContain("Name");
    expect(output).toContain("my-preset");
  });
});
