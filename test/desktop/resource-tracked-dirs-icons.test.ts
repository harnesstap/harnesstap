import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const modalSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceTrackedDirectoriesModal.tsx",
  ),
  "utf8",
);
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
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

const parentTitle = sliceBetween(
  modalSource,
  'className="resource-tracked-dirs-item-title"',
  "resource-tracked-dirs-path",
);

const parentMeta = sliceBetween(
  modalSource,
  'className="resource-tracked-dirs-meta muted"',
  "resource-tracked-dirs-item-expandable",
);

describe("tracked directories parent title icons", () => {
  test("imports RelatedHarnessIcons", () => {
    expect(modalSource).toMatch(
      /import \{ RelatedHarnessIcons \} from "\.\/HarnessIcons"/,
    );
  });

  test("renders icons after the directory label and before the kind badge", () => {
    const labelIdx = parentTitle.indexOf("{entry.label}");
    const iconsIdx = parentTitle.indexOf("RelatedHarnessIcons");
    const kindIdx = parentTitle.indexOf("resource-tracked-dirs-kind");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(iconsIdx).toBeGreaterThan(labelIdx);
    expect(kindIdx).toBeGreaterThan(iconsIdx);
    expect(parentTitle).toContain("harnessIds={entry.platform_ids}");
  });

  test("always passes platform_ids so empty lists omit the icon row", () => {
    expect(parentTitle).toContain(
      "<RelatedHarnessIcons harnessIds={entry.platform_ids} />",
    );
    expect(parentTitle).not.toContain("entry.platform_ids.length");
  });

  test("keeps comma-separated slugs on the parent meta line", () => {
    expect(parentMeta).toContain("entry.platform_ids.join(\", \")");
    expect(parentMeta).toContain("entry.resource_count");
  });

  test("parent title row stays a wrapping flex cluster", () => {
    const title = cssBlock(stylesSource, ".resource-tracked-dirs-item-title");
    expect(title).toContain("display: flex");
    expect(title).toContain("align-items: center");
    expect(title).toContain("flex-wrap: wrap");
    expect(title).toContain("gap: 0.45rem");
  });
});
