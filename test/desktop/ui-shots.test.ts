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
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const pin = readFileSync(
  join(root, "apps/desktop/scripts/visual-pin.env"),
  "utf8",
);
const desktopPkg = JSON.parse(
  readFileSync(join(root, "apps/desktop/package.json"), "utf8"),
) as { devDependencies: { playwright: string } };
const visualAction = readFileSync(
  join(root, ".github/actions/desktop-visual/action.yml"),
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
    expect(shots).toContain("openMoreItem");
    expect(shots).toContain("library-list-fab");
    expect(shots).toContain("header-more");
    expect(shots).toContain('name: "harnesses"');
  });

  test("desktop:check runs shots, compare, axe, reduced motion, and trace", () => {
    expect(check).toContain("--compare --axe");
    expect(check).toContain("--reduced-motion");
    expect(check).toContain("--trace");
    expect(contributing).toContain("bun run desktop:check");
  });

  test("nightly desktop-e2e runs a web-mode visual job", () => {
    expect(workflow).toContain("visual:");
    expect(visualAction).toContain("demo-home.sh");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).not.toContain("pull_request:");
    expect(visualAction).toContain("bun run desktop:check");
  });

  test("G8 pins Playwright Chromium and fonts via a container image", () => {
    expect(pin).toContain("PLAYWRIGHT_VERSION=1.63.0");
    expect(pin).toContain("mcr.microsoft.com/playwright:v1.63.0-noble");
    expect(desktopPkg.devDependencies.playwright).toMatch(/1\.63\.0/);
    expect(workflow).toContain("mcr.microsoft.com/playwright:v1.63.0-noble");
    expect(ci).toContain("mcr.microsoft.com/playwright:v1.63.0-noble");
    expect(shots).toContain("chromium.executablePath()");
    expect(shots).not.toMatch(/existsSync\("\/usr\/bin\/google-chrome-stable"\)/);
  });

  test("G8 requires visual on Desktop src PRs and uploads diff artifacts", () => {
    expect(ci).toContain("desktop-visual:");
    expect(ci).toContain("desktop_visual:");
    expect(ci).toContain("apps/desktop/src/**");
    expect(ci).toContain("check_required desktop-visual");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("desktop-visual-artifacts");
    expect(ci).toContain("desktop-visual-pr-artifacts");
  });

  test("reduced motion CSS clears animations instead of 0.01ms stubs", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation: none !important");
    expect(css).not.toContain("animation-duration: 0.01ms");
  });
});
