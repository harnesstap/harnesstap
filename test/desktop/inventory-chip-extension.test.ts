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
  it("are a pill badge with actions in an absolutely positioned extension", () => {
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

  it("share the fully rounded pill token with the resource type tabs", () => {
    const tokens = desktop("src/styles/tokens.css");
    expect(tokens).toContain("--radius-pill: 9999px;");
    expect(block(".inventory-chip")).toContain("--chip-radius: var(--radius-pill);");
    const library = desktop("src/styles/features/library.css");
    const tabStart = library.indexOf(".resource-type-tab {");
    expect(library.slice(tabStart, library.indexOf("}", tabStart))).toContain("border-radius: var(--radius-pill);");
  });

  it("read as one continuous pill while the extension shows", () => {
    // Badge: right end squared and its right border hidden, so no seam.
    expect(css).toMatch(/\.inventory-chip:has\(\.inventory-chip-extension\):hover,[^{]*\{\s*border-top-right-radius: 0;\s*border-bottom-right-radius: 0;\s*border-right-color: transparent;/);
    // Extension: starts flush at the badge edge, no left border, rounded right end.
    const ext = block(".inventory-chip-extension");
    expect(ext).toContain("left: 100%;");
    expect(ext).toContain("border-left: 0;");
    expect(ext).toContain("border-radius: 0 var(--chip-radius) var(--chip-radius) 0;");
    expect(ext).toContain("background: var(--chip-hover-bg);");
  });

  it("reveal on hover and on keyboard focus inside the badge", () => {
    expect(css).toContain(".inventory-chip:hover > .inventory-chip-extension,\n.inventory-chip:focus-within > .inventory-chip-extension");
  });

  it("reserve room at the end of every row for the widest extension", () => {
    const cluster = block(".inventory-chip-cluster");
    expect(cluster).toContain("--chip-extension-reserve: 7.5rem;");
    expect(cluster).toContain("padding-right: var(--chip-extension-reserve);");
  });

  it("puts the edit-mode Tools button in the extension, not on the pill", () => {
    const row = desktop("src/components/live/InventoryRow.tsx");
    expect(row).toContain("inventory-chip-extension");
    expect(row).toContain("const toolsControl = editMode && showScope");
    expect(row).toContain("{toolsControl}");
    expect(row).not.toContain("also-use-on");
    expect(row).not.toContain("inventory-chip-suggest-dot");
  });

  it("is guarded by a no-reflow walk step in the visual check", () => {
    const shots = desktop("scripts/ui-shots.mjs");
    expect(shots).toContain('name: "inventory-chip-hover"');
    expect(shots).toContain("assertNoReflow(page, before, \"hover\")");
    expect(shots).toContain("assertNoReflow(page, before, \"keyboard focus\")");
  });
});
