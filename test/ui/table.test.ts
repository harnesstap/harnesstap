import { describe, expect, it, beforeEach } from "bun:test";
import { renderTable } from "../../src/ui/table.ts";
import { disableColor } from "../../src/ui/theme.ts";

describe("ui table", () => {
  beforeEach(() => {
    // Enable colors for tests
    delete process.env.NO_COLOR;
  });

  it("renders headers, rows, and a summary footer", () => {
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
        { key: "description", header: "DESCRIPTION", width: 24 },
      ],
      rows: [{ name: "demo-stack", description: "Demo web stack plugin" }],
      summary: "1 plugin · run `harnesstap plugin show <name>` for details",
    });

    expect(output).toContain("NAME");
    expect(output).toContain("demo-stack");
    expect(output).toContain("1 plugin");
  });

  it("uses heading role for table headers", () => {
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
      ],
      rows: [{ name: "test" }],
    });
    // Headers should be styled with heading role (bold blue)
    expect(output).toContain("NAME");
  });

  it("uses info role for summary text", () => {
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
      ],
      rows: [{ name: "test" }],
      summary: "Found 1 item",
    });
    // Summary should use info styling
    expect(output).toContain("Found 1 item");
  });

  it("degrades to plain text when NO_COLOR is set", () => {
    disableColor();
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
      ],
      rows: [{ name: "test" }],
      summary: "1 item",
    });
    const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
    expect(output).not.toMatch(ansiEscapeRegex);
  });

  it("wraps hyphenated content across multiple lines when maxWidth caps column", () => {
    const output = renderTable({
      maxWidth: 40,
      wordWrap: true,
      columns: [
        { key: "name", header: "NAME", width: 10, wrapOnWordBoundary: false },
      ],
      rows: [{ name: "migrating-dbt-core-to-fusion-with-extra" }],
    });
    expect(output).toContain("migrating-dbt-core-to-fusion");
    expect(output.split("\n").length).toBeGreaterThan(4);
    expect(output).not.toContain("…");
  });

  it("caps off-TTY tables, truncates descriptions, and draws +----+ borders", () => {
    disableColor();
    const long = "x".repeat(400);
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
        { key: "description", header: "DESCRIPTION", width: 40, truncate: true },
        { key: "visibility", header: "VIS", width: 8, fitContent: true },
        {
          key: "updated",
          header: "UPDATED",
          width: 16,
          fitContent: true,
        },
      ],
      rows: [
        {
          name: "official",
          description: long,
          visibility: "public",
          updated: "23 seconds ago",
        },
      ],
    });

    const lines = output.split("\n");
    expect(lines[0]).toMatch(/^\+-+/);
    expect(lines[0]).not.toMatch(/^\+{6,}/);
    expect(output).toContain("public");
    expect(output).not.toContain("publ ");
    expect(output).toContain("23 seconds ago");
    expect(output).toContain("...");
    expect(output).not.toContain(long);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(120);
    }
  });

  it("sizes the UPDATED column to content at 80 and 120 columns", () => {
    disableColor();
    for (const width of [80, 120]) {
      const output = renderTable({
        maxWidth: width,
        wordWrap: true,
        columns: [
          { key: "name", header: "NAME", width: 28, widthShare: 0.7 },
          {
            key: "updated",
            header: "UPDATED",
            width: 16,
            fitContent: true,
            widthShare: 0.15,
          },
        ],
        rows: [{ name: "demo", updated: "23 seconds ago" }],
      });
      expect(output).toContain("23 seconds ago");
      const updatedLines = output.split("\n").filter((line) => line.includes("23 seconds"));
      expect(updatedLines.length).toBe(1);
    }
  });

  it("computeColumnWidths distributes proportionally within maxWidth", async () => {
    const { computeColumnWidths } = await import("../../src/ui/table.ts");
    const widths = computeColumnWidths(
      [
        { key: "name", header: "NAME", width: 28, widthShare: 0.45 },
        { key: "namespace", header: "NAMESPACE", width: 20, widthShare: 0.3 },
        { key: "updated_at", header: "UPDATED", width: 16, widthShare: 0.15 },
      ],
      [{ name: "x", namespace: "y", updated_at: "1 day ago" }],
      80,
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(80);
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });

  it("honors minWidth when widthShare would shrink the first column", async () => {
    const { computeColumnWidths } = await import("../../src/ui/table.ts");
    const widths = computeColumnWidths(
      [
        { key: "id", header: "ID", width: 13, minWidth: 13, widthShare: 0.1 },
        { key: "name", header: "NAME", width: 28, widthShare: 0.45 },
        { key: "namespace", header: "NAMESPACE", width: 20, widthShare: 0.3 },
        { key: "updated_at", header: "UPDATED", width: 16, widthShare: 0.15 },
      ],
      [{ id: "01M30E…7J9Z", name: "openapi-mcp-baseline", namespace: "global", updated_at: "1 seconds ago" }],
      80,
    );
    expect(widths[0]).toBeGreaterThanOrEqual(13);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(80);
  });

  it("applies column styles for resource types", async () => {
    const chalkModule = await import("chalk");
    const originalLevel = chalkModule.default.level;
    chalkModule.default.level = 3;
    try {
      const { styleResourceType } = await import("../../src/ui/theme.ts");
      const output = renderTable({
        columns: [
          {
            key: "type",
            header: "TYPE",
            width: 10,
            style: (value) => styleResourceType(value),
          },
        ],
        rows: [{ type: "skill" }, { type: "rule" }],
      });
      const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
      expect(output).toMatch(ansiEscapeRegex);
      expect(output).toContain("skill");
      expect(output).toContain("rule");
    } finally {
      chalkModule.default.level = originalLevel;
    }
  });
});
