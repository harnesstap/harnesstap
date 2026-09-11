import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const editSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/EditProfilePane.tsx"),
  "utf8",
);
const paritySlotsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/EditProfileParitySlots.tsx",
  ),
  "utf8",
);
const deleteSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/ProfileDeleteControls.tsx",
  ),
  "utf8",
);
const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
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

const editHeader = sliceBetween(
  editSource,
  'className="edit-profile-header-actions"',
  "edit-profile-body",
);
const liveToolbar = sliceBetween(
  appSource,
  'className="live-toolbar"',
  "statusError",
);
const liveStatusLine = sliceBetween(
  liveToolbar,
  'className="status-line"',
  "status-subline",
);

describe("profile delete chrome", () => {
  test("places Remove profile in the edit-pane header next to Done", () => {
    const deleteIdx = editHeader.indexOf("ProfileDeleteControls");
    const doneIdx = editHeader.indexOf('label="Done editing"');
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(doneIdx).toBeGreaterThan(deleteIdx);
    expect(editHeader).toContain('variant="icon"');
    expect(editHeader).not.toContain("profile-delete-footer");
  });

  test("does not keep Remove profile in the edit-pane body slots", () => {
    expect(paritySlotsSource).not.toContain("ProfileDeleteControls");
  });

  test("keeps a confirm dialog and delete-plugin checkbox, with an icon variant", () => {
    expect(deleteSource).toContain('variant?: "labeled" | "icon"');
    expect(deleteSource).toContain("IconActionButton");
    expect(deleteSource).toContain("Trash2");
    expect(deleteSource).toContain('label="Remove profile"');
    expect(deleteSource).toContain("profile-remove-action");
    expect(deleteSource).not.toContain("profile-delete-footer");
    expect(deleteSource).toContain("ConfirmDialog");
    expect(deleteSource).toContain("Also delete the plugin from the library");
  });

  test("places the icon control on the trailing live-toolbar, not beside rail create", () => {
    expect(liveStatusLine).not.toContain("ProfileDeleteControls");
    expect(liveToolbar).toContain("live-toolbar-remove");
    expect(liveToolbar).toContain("ProfileDeleteControls");
    expect(liveToolbar).toContain('variant="icon"');
    expect(stylesSource).toContain(".profile-remove-action");
    expect(stylesSource).toContain("var(--red)");
    expect(designSource).toContain("trailing live-toolbar control");
    expect(designSource).toContain("destructive-tinted");
  });

  test("sizes the labeled header button as a compact cluster control", () => {
    const cluster = cssBlock(stylesSource, ".profile-delete-control .icon-action.has-label");
    expect(cluster).toContain("width: auto");
    expect(cluster).toContain("min-height: 32px");
    expect(cluster).not.toContain("width: 100%");
  });

  test("documents icon Remove profile in the edit header and live-state", () => {
    expect(designSource).toContain("**Remove profile**");
    expect(designSource).toContain("edit-profile header");
    expect(designSource).toContain("edit-profile header next to Done");
    expect(designSource).toContain("delete-plugin checkbox");
    expect(designSource).toContain("icon-only trash control");
    expect(designSource).toContain("trailing live-toolbar control");
  });
});
