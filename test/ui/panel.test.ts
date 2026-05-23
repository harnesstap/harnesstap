import { describe, expect, it } from "vitest";
import { renderPanel } from "../../src/ui/panel.ts";

describe("ui panel", () => {
  it("renders title and key-value rows", () => {
    const output = renderPanel({
      title: ["Details"],
      rows: [
        ["Name", "my-preset"],
        ["Tags", "core, shared"],
      ],
    });
    expect(output).toContain("Details");
    expect(output).toContain("Name");
    expect(output).toContain("my-preset");
  });

  it("aligns key column to 20 characters (delegates to renderKv)", () => {
    const output = renderPanel({ title: ["Details"], rows: [["Name", "my-preset"]] });
    // "Name" (4 chars) padded to 20 = 4 + 16 trailing spaces
    expect(output).toContain(`Name${" ".repeat(16)}`);
  });
});
