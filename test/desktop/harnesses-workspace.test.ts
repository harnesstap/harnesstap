import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const workspaceSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/harnesses/HarnessesWorkspace.tsx",
  ),
  "utf8",
);
const liveHeaderSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/LiveHeader.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/harnesses/HarnessDetail.tsx"),
  "utf8",
);
const filterMenuSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/harnesses/HarnessFilterMenu.tsx",
  ),
  "utf8",
);
const sidebarSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/harnesses/HarnessSidebar.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
const stylesSource = readDesktopCss();

function cssBlock(source: string, selector: string): string {
  const needle = `\n${selector} {`;
  const start = source.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 1);
}

describe("Harnesses workspace sidebar width", () => {
  it("uses a content-sized list column instead of the Library 220px filter track", () => {
    expect(workspaceSource).toContain(
      'className="resources-panel-layout harnesses-workspace-layout"',
    );
    const layout = cssBlock(
      stylesSource,
      ".resources-panel-layout.harnesses-workspace-layout",
    );
    expect(layout).toContain("--resources-sidebar-track: minmax(11rem, max-content)");
    expect(layout).not.toContain("220px");
    const sidebar = cssBlock(stylesSource, ".harness-list-sidebar");
    expect(sidebar).toContain("width: max-content");
    expect(sidebar).toContain("max-width: 16rem");
    expect(sidebar).toContain("min-width: 11rem");
    const empty = cssBlock(stylesSource, ".harness-list-sidebar .empty-state");
    expect(empty).toContain("max-width: 11rem");
  });

  it("paints selected and hover chrome across the reserved trash slot", () => {
    expect(sidebarSource).toContain("inventory-row-remove-slot");
    expect(sidebarSource).toContain("inventory-row-remove-placeholder");
    expect(stylesSource).toContain(
      ".harness-list-row:has(.resources-list-env.is-selected)",
    );
    expect(stylesSource).toContain(
      ".harness-list-row .resources-list-env.is-selected",
    );
  });

  it("documents the harness list column vs the Library filter track", () => {
    expect(designSource).toContain("not the 220px Library filter track");
    expect(designSource).toContain("reserved trash slot");
  });
});

describe("Harnesses resource filter field", () => {
  it("uses a compact Filter resources field with a trailing origin menu", () => {
    expect(liveHeaderSource).toContain("compactSearch");
    expect(liveHeaderSource).toContain('spellCheck={false}');
    expect(liveHeaderSource).toContain('autoComplete="off"');
    expect(detailSource).toContain("compactSearch");
    expect(detailSource).toContain("HarnessFilterMenu");
    expect(filterMenuSource).toContain("Filter per harness origin");
    expect(filterMenuSource).toContain("Marketplace");
    expect(filterMenuSource).toContain('data-testid="harness-resource-filter"');
    expect(stylesSource).toContain(".list-search-compact");
    expect(cssBlock(stylesSource, ".list-search-compact")).toContain("max-width: 20rem");
  });

  it("documents origin and marketplace facets on Filter resources", () => {
    expect(designSource).toContain("compact **Filter resources** field");
    expect(designSource).toContain("Filter per harness origin");
    expect(designSource).toContain("case-insensitive substring of the typed query");
    expect(designSource).not.toContain("did you mean");
  });
});
