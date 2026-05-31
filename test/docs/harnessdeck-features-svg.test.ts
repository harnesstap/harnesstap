import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

describe("HarnessDeck features SVG", () => {
  test("documents the approved HarnessDeck feature map", async () => {
    const svg = await readFile("docs/assets/harnessdeck-features.svg", "utf8");

    expect(svg).toStartWith("<svg ");
    expect(svg).toContain("<title>HarnessDeck feature map</title>");
    expect(svg).toContain("<desc>");

    const requiredLabels = [
      "HarnessDeck",
      "Claude Code",
      "Cursor",
      "Codex",
      "GitHub Copilot",
      "Scan",
      "SQLite library",
      "Reusable presets",
      "Apply &amp; sync",
      "Snapshots",
      "Drift detection",
      "Plugin governance",
      "Cloud sharing",
      "Migration export",
    ];

    for (const label of requiredLabels) {
      expect(svg).toContain(label);
    }
  });
});
