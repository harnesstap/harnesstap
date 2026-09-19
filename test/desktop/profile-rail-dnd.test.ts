import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopShellSource } from "../helpers/desktop-shell-source";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const appSource = readDesktopShellSource();
const cssSource = readDesktopCss();
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("desktop profile rail drag and drop", () => {
  test("wires HTML5 drag handlers on profile rail rows", () => {
    expect(appSource).toContain("draggable={canReorderProfiles}");
    expect(appSource).toContain("onDragStart");
    expect(appSource).toContain("onDrop");
    expect(appSource).toContain("saveProfileRailOrder");
  });

  test("pins the active profile first and selects it until the user picks another", () => {
    expect(appSource).toContain("pinNameFirst");
    expect(appSource).toContain("resolveRailProfileSelection");
    expect(appSource).toContain("status?.active_profile");
    expect(appSource).toContain('useState<ProfileSelectionIntent>("unset")');
  });

  test("does not enable drag while the profile filter is active", () => {
    expect(appSource).toContain("canReorderProfiles");
    expect(appSource).toMatch(/profileFilter\.trim\(\)/);
  });

  test("marks dragging and drop-target rows in CSS with a 2px accent line", () => {
    expect(cssSource).toContain(".profile-item.dragging");
    expect(cssSource).toContain(".profile-item.drop-target-before");
    expect(cssSource).toContain(".profile-item.drop-target-after");
    expect(cssSource).toContain("0 -2px 0 var(--accent)");
    expect(cssSource).toContain("0 2px 0 var(--accent)");
  });

  test("exposes a GripVertical handle and Alt arrow keyboard reorder", () => {
    expect(appSource).toContain("GripVertical");
    expect(appSource).toContain("profile-item-handle");
    expect(appSource).toContain("moveNameByDelta");
    expect(appSource).toContain("ArrowUp");
    expect(appSource).toContain("ArrowDown");
    expect(designSource).toContain("GripVertical");
    expect(designSource).toContain("Alt+↑/↓");
  });

  test("DESIGN.md records desktop-only rail order", () => {
    expect(designSource).toContain(
      "Profile rail order is a desktop-only localStorage preference",
    );
    expect(designSource).toContain(
      "The applied/active profile for the current view stays first in the list",
    );
  });
});
