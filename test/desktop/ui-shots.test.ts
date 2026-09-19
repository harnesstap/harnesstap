import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const root = join(import.meta.dir, "../..");
const shots = readFileSync(
  join(root, "apps/desktop/scripts/ui-shots.mjs"),
  "utf8",
);
const check = readFileSync(
  join(root, "apps/desktop/scripts/desktop-check.sh"),
  "utf8",
);
const workflow = readFileSync(
  join(root, ".github/workflows/desktop-e2e.yml"),
  "utf8",
);
const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
const css = readDesktopCss();

describe("desktop visual check", () => {
  test("ui-shots supports compare, axe, reduced motion, and trace", () => {
    expect(shots).toContain("--compare");
    expect(shots).toContain("--update-baselines");
    expect(shots).toContain("--axe");
    expect(shots).toContain("--trace");
    expect(shots).toContain("--reduced-motion");
    expect(shots).toContain("AxeBuilder");
    expect(shots).toContain("compareShot");
    expect(shots).toContain("getAnimations");
    expect(shots).toContain("FRAME_BUDGET_MS = 32");
  });

  test("desktop:check runs shots, compare, axe, reduced motion, and trace", () => {
    expect(check).toContain("--compare --axe");
    expect(check).toContain("--reduced-motion");
    expect(check).toContain("--trace");
    expect(contributing).toContain("bun run desktop:check");
  });

  test("nightly desktop-e2e runs a web-mode visual job", () => {
    expect(workflow).toContain("visual:");
    expect(workflow).toContain("bun run desktop:check");
    expect(workflow).toContain("demo-home.sh");
  });

  test("reduced motion CSS clears animations instead of 0.01ms stubs", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation: none !important");
    expect(css).not.toContain("animation-duration: 0.01ms");
  });
});
