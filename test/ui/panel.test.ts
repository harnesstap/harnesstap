import { describe, expect, it } from "bun:test";
import { renderPanel, kvBlock } from "../../src/ui/panel.ts";

describe("ui panel", () => {
  it("renders title and key-value rows", () => {
    const output = renderPanel({
      title: ["Details"],
      rows: [
        ["Name", "my-plugin"],
        ["Tags", "core, shared"],
      ],
    });
    expect(output).toContain("Details");
    expect(output).toContain("Name");
    expect(output).toContain("my-plugin");
  });

  it("aligns key column to 20 characters (delegates to renderKv)", () => {
    const output = renderPanel({ title: ["Details"], rows: [["Name", "my-plugin"]] });
    // "Name" (4 chars) padded to 20 = 4 + 16 trailing spaces
    expect(output).toContain(`Name${" ".repeat(16)}`);
  });

  it("kvBlock supports custom indent and keyWidth", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      kvBlock([
        { key: "Contains", value: "CLAUDE.md" },
      ], { indent: 4, keyWidth: 10 });
      expect(logs[0].startsWith("    ")).toBe(true);
      expect(logs[0]).toContain("Contains");
    } finally {
      console.log = originalLog;
    }
  });
});
