import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../apps/desktop");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const css = read("src/styles/features/scope.css");
const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("Profiles rail names", () => {
  test("take the free width and ellipsize only on overflow", () => {
    const name = block(".profile-item-name");
    expect(name).toContain("flex: 1 1 auto;");
    expect(name).toContain("min-width: 0;");
    expect(name).toContain("text-overflow: ellipsis;");
    expect(name).toContain("white-space: nowrap;");
  });

  test("reserve no width for the hover grip", () => {
    expect(block(".profile-item-handle")).toContain("position: absolute;");
    expect(block(".profile-item")).toContain("position: relative;");
    expect(block(".profile-item")).not.toMatch(/\bgap:/);
  });

  test("keep the in-use mark in a compact leading slot", () => {
    const mark = block(".profile-item-main .profile-header-status");
    expect(mark).toContain("width: 16px;");
  });

  test("show the full name in a tooltip only when it is cut", () => {
    const source = read("src/components/shell/RailProfileName.tsx");
    expect(source).toContain("element.scrollWidth > element.clientWidth + 1");
    expect(source).toContain("new ResizeObserver(measure)");
    expect(source).toMatch(/truncated \? \(\s*<ChromeTooltip content=\{name\}/);
    expect(read("src/components/shell/ProfilesRail.tsx")).toContain("<RailProfileName name={profile.name} />");
  });

  test("is guarded in the visual walk against empty reserved slots", () => {
    const shots = read("scripts/ui-shots.mjs");
    expect(shots).toContain("await assertRailNamesUseFullWidth(page);");
    expect(shots).toContain("reserves ${Math.round(width)}px");
  });
});
