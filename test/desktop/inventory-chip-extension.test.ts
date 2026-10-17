import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const desktop = (path: string) => readFileSync(join(import.meta.dir, "../../apps/desktop", path), "utf8");
const css = desktop("src/styles/features/scope.css");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};

describe("resource badge actions", () => {
  it("are a rounded-rectangle badge with actions in an absolutely positioned extension", () => {
    expect(block(".inventory-chip")).toContain("position: relative;");
    expect(block(".inventory-chip")).toContain("border-radius: var(--chip-radius);");
    const ext = block(".inventory-chip-extension");
    expect(ext).toContain("position: absolute;");
    expect(ext).toContain("left: 100%;");
    expect(ext).toContain("opacity: 0;");
    expect(ext).toContain("pointer-events: none;");
    // Never a width change: the extension must not take part in layout.
    expect(ext).not.toMatch(/\bwidth:/);
  });

  it("reveal on hover and on keyboard focus inside the badge", () => {
    expect(css).toContain(".inventory-chip:hover > .inventory-chip-extension,\n.inventory-chip:focus-within > .inventory-chip-extension");
  });

  it("reserve room at the end of every row for the widest extension", () => {
    const cluster = block(".inventory-chip-cluster");
    expect(cluster).toContain("--chip-extension-reserve: 7rem;");
    expect(cluster).toContain("padding-right: var(--chip-extension-reserve);");
  });

  it("puts Also use on and Not now in the extension as icon buttons with tooltips", () => {
    const row = desktop("src/components/live/InventoryRow.tsx");
    expect(row).toContain("inventory-chip-extension");
    expect(row).toContain('data-testid="also-use-on-accept"');
    expect(row).toContain('title="Not now"');
    expect(row).toContain("inlineSuggestion={false}");
  });

  it("is guarded by a no-reflow walk step in the visual check", () => {
    const shots = desktop("scripts/ui-shots.mjs");
    expect(shots).toContain('name: "inventory-chip-hover"');
    expect(shots).toContain("assertNoReflow(page, before, \"hover\")");
    expect(shots).toContain("assertNoReflow(page, before, \"keyboard focus\")");
  });
});
