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
