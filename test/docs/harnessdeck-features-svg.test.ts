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

describe("HarnessTap features SVG", () => {
  test("documents the approved HarnessTap feature map", async () => {
    const svg = await readFile("docs/assets/harnessdeck-features.svg", "utf8");
    const rootTag = svg.match(/^<svg([^>]*)>/);
    const title = matchTag(svg, "title");
    const description = matchTag(svg, "desc");

    expect(rootTag).not.toBeNull();
    expect(title?.[2]).toBe("HarnessTap feature map");
    expect(description?.[2]).toContain("HarnessTap connects");
    expect(matchAttribute(rootTag?.[1] ?? "", "aria-labelledby")).toBe("title");
    expect(matchAttribute(rootTag?.[1] ?? "", "aria-describedby")).toBe("desc");
    expect(matchAttribute(title?.[1] ?? "", "id")).toBe("title");
    expect(matchAttribute(description?.[1] ?? "", "id")).toBe("desc");
    expect(countOccurrences(svg, "Agent harnesses")).toBe(1);
    expect(countOccurrences(svg, 'class="panel"')).toBe(1);
    expect(countOccurrences(svg, 'class="chipText"')).toBe(7);
    expect(svg).toContain("Export libraries, harness prefs, and config across machines.");
    expect(svg).toContain("Catalog baselines,");
    expect(svg).toContain("env cascade");
    expect(svg).toContain("layer deps");

    const requiredLabels = [
      "HarnessTap",
      "Agent harness configuration toolkit",
      "Agent harnesses",
      "Claude Code",
      "Cursor",
      "Codex",
      "GitHub Copilot",
      "25+ more CLIs",
      "Scan",
      "Library",
      "Compose",
      "Apply",
      "Snapshots",
      "Drift",
      "Plugins",
      "Cloud",
      "Migrate",
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
