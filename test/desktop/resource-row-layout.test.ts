import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resourceRowVirtualStyle } from "../../apps/desktop/src/lib/resource-row-virtual.ts";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const root = join(import.meta.dir, "../../apps/desktop/src");
const libraryListSource = readFileSync(
  join(root, "components/library/LibraryResourceList.tsx"),
  "utf8",
);
const inventorySectionSource = readFileSync(
  join(root, "components/live/InventorySection.tsx"),
  "utf8",
);
const addModalSource = readFileSync(
  join(root, "components/ScopeAddToProfileModal.tsx"),
  "utf8",
);
const stylesSource = readDesktopCss();

function cssBlock(source: string, selector: string): string {
  const start = source.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

describe("resource row layout", () => {
  it("does not lock virtual wrappers to the estimated height", () => {
    const style = resourceRowVirtualStyle(80, 12);
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBeUndefined();
    expect(style.transform).toBe("translateY(68px)");
  });

  it("lets shared ResourceRow chrome grow with wrapped copy", () => {
    const row = cssBlock(stylesSource, ".resource-row");
    expect(row).toContain("height: auto;");
    expect(row).toContain("min-height: calc(var(--space-8) + var(--space-2));");
    expect(row).not.toMatch(/height:\s*100%/);

    const virtualInner = cssBlock(
      stylesSource,
      ".resources-list-virtual-item .resource-row",
    );
    expect(virtualInner).toContain("height: auto;");
    expect(virtualInner).not.toMatch(/height:\s*100%/);

    const inventoryBlocks = [
      ...stylesSource.matchAll(/\.resource-row\.inventory-row \{[^}]+\}/g),
    ].map((match) => match[0]);
    expect(inventoryBlocks.length).toBeGreaterThan(0);
    for (const block of inventoryBlocks) {
      expect(block).toContain("height: auto;");
      expect(block).not.toMatch(/^\s*height:\s*calc/m);
    }
  });

  it("measures Library, inventory, and add-to-profile virtual rows", () => {
    for (const source of [
      libraryListSource,
      inventorySectionSource,
      addModalSource,
    ]) {
      expect(source).toContain("measureElement");
      expect(source).toContain("resourceRowVirtualStyle");
      expect(source).not.toContain("height: `${virtualRow.size}px`");
    }
    expect(libraryListSource).not.toContain("height,");
  });
});
