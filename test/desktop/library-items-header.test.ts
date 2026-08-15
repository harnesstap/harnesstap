import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourcesPanel.tsx",
  ),
  "utf8",
);
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function sliceBetween(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function cssBlock(source: string, selector: string): string {
  const needle = `\n${selector} {`;
  const start = source.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 1);
}

const headerRow = sliceBetween(
  panelSource,
  'className="resources-panel-header-row"',
  "resources-panel-layout",
);

describe("library items header actions", () => {
  test("clusters Import and Tracked directories instead of spreading them as siblings", () => {
    expect(headerRow).toContain('className="resources-panel-header-actions"');
    const clusterIdx = headerRow.indexOf("resources-panel-header-actions");
    const importIdx = headerRow.indexOf('className="btn primary"');
    const trackedIdx = headerRow.indexOf('className="btn"\n');
    expect(importIdx).toBeGreaterThan(clusterIdx);
    expect(trackedIdx).toBeGreaterThan(importIdx);
    expect(headerRow).not.toContain("icon-action");
  });

  test("renders Import as a labeled accent primary action", () => {
    expect(headerRow).toContain('aria-label="Import into library"');
    expect(headerRow).toContain('title="Import into library"');
    expect(headerRow).toContain('className="btn primary"');
    expect(headerRow).toMatch(/<FolderDown[\s\S]*\/>\s*Import\s*</);
    expect(headerRow).toContain("setImportOpen(true)");
  });

  test("renders Tracked directories as a labeled secondary action", () => {
    expect(headerRow).toContain('aria-label="Tracked directories"');
    expect(headerRow).toContain(
      'title="Show tracked directories for resources"',
    );
    expect(headerRow).toMatch(/className="btn"\n/);
    expect(headerRow).toMatch(
      /<FolderInput[\s\S]*\/>\s*Tracked directories\s*</,
    );
    expect(headerRow).toContain("setTrackedDirsOpen(true)");
    expect(headerRow).not.toContain("resources-panel-tracked-dirs-btn");
  });

  test("keeps the empty-state Import into library CTA", () => {
    expect(panelSource).toMatch(
      /empty-state[\s\S]*className="btn"[\s\S]*Import into library/,
    );
  });
});

describe("library items header action styles", () => {
  test("groups header actions as a compact flex cluster", () => {
    const cluster = cssBlock(stylesSource, ".resources-panel-header-actions");
    expect(cluster).toContain("display: flex");
    expect(cluster).toContain("gap: 0.4rem");
  });

  test("overrides full-width dialog button sizing on cluster buttons", () => {
    const clusterBtn = cssBlock(
      stylesSource,
      ".resources-panel-header-actions .btn",
    );
    expect(clusterBtn).toContain("width: auto");
    expect(clusterBtn).not.toContain("width: 100%");
    expect(clusterBtn).not.toContain("min-height: 44px");

    const dialogBtn = cssBlock(stylesSource, ".btn");
    expect(dialogBtn).toContain("width: 100%");
    expect(dialogBtn).toContain("min-height: 44px");
  });

  test("drops the unused tracked-dirs icon-action class", () => {
    expect(stylesSource).not.toContain(".resources-panel-tracked-dirs-btn");
  });
});

describe("library items header design lock", () => {
  test("documents the Items header action cluster", () => {
    expect(designSource).toContain("Library Items header");
    expect(designSource).toContain("compact action cluster");
  });
});
