import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

function matchTag(source: string, tagName: string): RegExpMatchArray | null {
  return source.match(new RegExp(`<${tagName}([^>]*)>([\\s\\S]*?)</${tagName}>`));
}

function matchAttribute(source: string, attributeName: string): string | undefined {
  return source.match(new RegExp(`${attributeName}="([^"]+)"`))?.[1];
}

function decodeXmlText(source: string): string {
  return source
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function countOccurrences(source: string, text: string): number {
  return source.split(text).length - 1;
}

describe("HarnessDeck features SVG", () => {
  test("documents the approved HarnessDeck feature map", async () => {
    const svg = await readFile("docs/assets/harnessdeck-features.svg", "utf8");
    const rootTag = svg.match(/^<svg([^>]*)>/);
    const title = matchTag(svg, "title");
    const description = matchTag(svg, "desc");

    expect(rootTag).not.toBeNull();
    expect(title?.[2]).toBe("HarnessDeck feature map");
    expect(description?.[2]).toContain("HarnessDeck connects");
    expect(matchAttribute(rootTag?.[1] ?? "", "aria-labelledby")).toBe("title");
    expect(matchAttribute(rootTag?.[1] ?? "", "aria-describedby")).toBe("desc");
    expect(matchAttribute(title?.[1] ?? "", "id")).toBe("title");
    expect(matchAttribute(description?.[1] ?? "", "id")).toBe("desc");
    expect(countOccurrences(svg, "Agent harnesses")).toBe(1);
    expect(svg).toContain('<tspan x="334" dy="0">Move libraries, preferences, and config</tspan>');
    expect(svg).toContain('<tspan x="334" dy="22">across harnesses without losing structure.</tspan>');

    const requiredLabels = [
      "HarnessDeck",
      "Agent harnesses",
      "Claude Code",
      "Cursor",
      "Codex",
      "GitHub Copilot",
      "Other CLIs",
      "Scan",
      "SQLite library",
      "Reusable presets",
      "Apply & sync",
      "Snapshots",
      "Drift detection",
      "Plugin governance",
      "Cloud sharing",
      "Migration export",
    ];
    const removedLabels = ["Future Harnesses"];
    const textContent = decodeXmlText(svg.replace(/<[^>]+>/g, " "));

    for (const label of requiredLabels) {
      expect(textContent).toContain(label);
    }

    for (const label of removedLabels) {
      expect(textContent).not.toContain(label);
    }
  });
});
