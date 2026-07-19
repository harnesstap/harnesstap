import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

const FLOW_SPLIT_OUTPUTS = [
  ['d="M12.5 16C17 16 17 7.5 22 7.5H29"', 'stroke="#8B5CF6"'],
  ['d="M12.5 16H29"', 'stroke="#3B82F6"'],
  ['d="M12.5 16C17 16 17 24.5 22 24.5H29"', 'stroke="#14B8A6"'],
] as const;
const FLOW_SPLIT_INLET =
  'd="M3 13.25H13.5A2.75 2.75 0 0 1 13.5 18.75H3A2.75 2.75 0 0 1 3 13.25Z" fill="#3B82F6"';
const ASSETS = [
  {
    path: "docs/assets/harnesstap-mark.svg",
    titleId: "ht-mark-title",
    descriptionId: "ht-mark-description",
  },
  {
    path: "docs/assets/harnesstap-lockup.svg",
    titleId: "ht-lockup-title",
    descriptionId: "ht-lockup-description",
  },
] as const;

describe("HarnessTap shared brand assets", () => {
  for (const { path, titleId, descriptionId } of ASSETS) {
    test(`${path} carries the complete portable Flow Split contract`, async () => {
      const svg = await readFile(path, "utf8");
      const root = svg.match(/^<svg[^>]*>/)?.[0];

      expect(root).toContain(`aria-labelledby="${titleId}"`);
      expect(root).toContain(`aria-describedby="${descriptionId}"`);
      expect(svg).toContain(`<title id="${titleId}">HarnessTap</title>`);
      expect(svg).toContain(`<desc id="${descriptionId}">`);
      for (const [pathData, stroke] of FLOW_SPLIT_OUTPUTS) {
        expect(svg).toContain(`${pathData} ${stroke}`);
      }
      expect(svg).toContain(FLOW_SPLIT_INLET);
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("<text");
      expect(svg).not.toContain("@font-face");
    });
  }

  test("lockup provides its outlined wordmark in light and dark themes", async () => {
    const lockup = await readFile("docs/assets/harnesstap-lockup.svg", "utf8");

    expect(lockup).toContain('id="harnesstap-wordmark"');
    expect(lockup).toContain("#harnesstap-wordmark { fill: #0F172A; }");
    expect(lockup).toContain("@media (prefers-color-scheme: dark)");
    expect(lockup).toContain("#harnesstap-wordmark { fill: #F8FAFC; }");
    expect(lockup).not.toContain('fill="currentColor"');
  });

  test("README exposes the lockup image as its semantic H1", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).toMatch(
      /<h1>\s*<img src="docs\/assets\/harnesstap-lockup\.svg" alt="HarnessTap" width="320" \/>\s*<\/h1>/,
    );
  });
});
