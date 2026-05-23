import { describe, expect, it } from "vitest";
import { renderTable } from "../../src/ui/table.ts";

describe("ui table", () => {
  it("renders headers, rows, and a summary footer", () => {
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
        { key: "description", header: "DESCRIPTION", width: 24 },
      ],
      rows: [{ name: "nextjs-fullstack", description: "Next.js fullstack preset" }],
      summary: "1 preset · run `harnessdeck preset show <name>` for details",
    });

    expect(output).toContain("NAME");
    expect(output).toContain("nextjs-fullstack");
    expect(output).toContain("1 preset");
  });
});
