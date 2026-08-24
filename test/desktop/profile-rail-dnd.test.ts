import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const cssSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);
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

  test("does not enable drag while the profile filter is active", () => {
    expect(appSource).toContain("canReorderProfiles");
    expect(appSource).toMatch(/profileFilter\.trim\(\)/);
  });

  test("marks dragging and drop-target rows in CSS with accent", () => {
    expect(cssSource).toContain(".profile-item.dragging");
    expect(cssSource).toContain(".profile-item.drop-target-before");
    expect(cssSource).toContain(".profile-item.drop-target-after");
    expect(cssSource).toContain("var(--accent)");
  });

  test("DESIGN.md records desktop-only rail order", () => {
    expect(designSource).toContain(
      "Profile rail order is a desktop-only localStorage preference",
    );
  });
});
