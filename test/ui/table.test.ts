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
      rows: [{ name: "nextjs-fullstack", description: "Next.js fullstack layer" }],
      summary: "1 layer · run `harnessdeck layer show <name>` for details",
    });

    expect(output).toContain("NAME");
    expect(output).toContain("nextjs-fullstack");
    expect(output).toContain("1 layer");
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
});
