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

const folderLabel = sliceBetween(
  modalSource,
  'className="resource-tracked-dirs-folder-label"',
  "resource-tracked-dirs-path",
);

const folderMeta = sliceBetween(
  modalSource,
  "folder.platform_ids.length > 0",
  "resource-tracked-dirs-open",
);

describe("tracked directories nested folder icons", () => {
  test("renders icons after the folder name", () => {
    const labelIdx = folderLabel.indexOf("{folder.label}");
    const iconsIdx = folderLabel.indexOf("RelatedHarnessIcons");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(iconsIdx).toBeGreaterThan(labelIdx);
    expect(folderLabel).toContain(
      "<RelatedHarnessIcons harnessIds={folder.platform_ids} />",
    );
    expect(folderLabel).not.toContain("folder.platform_ids.length");
  });

  test("keeps comma-separated slugs on the folder meta line", () => {
    expect(folderMeta).toContain("folder.platform_ids.join(\", \")");
  });

  test("folder label row matches parent title flex alignment", () => {
    const label = cssBlock(
      stylesSource,
      ".resource-tracked-dirs-folder-label",
    );
    expect(label).toContain("display: flex");
    expect(label).toContain("align-items: center");
    expect(label).toContain("flex-wrap: wrap");
    expect(label).toContain("gap: 0.45rem");
    expect(label).toContain("font-size: 12px");
    expect(label).toContain("font-weight: 600");
  });
});
