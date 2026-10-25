import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopShellSource } from "../helpers/desktop-shell-source";
import { readDesktopCss } from "./helpers/desktop-css.ts";

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
const appSource = readDesktopShellSource();
const stylesSource = readDesktopCss();
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
  test("puts Delete last in the edit-pane overflow, before Done; no visible trash", () => {
    const overflowIdx = editHeader.indexOf("<OverflowMenu");
    const deleteIdx = editHeader.indexOf("ProfileDeleteControls");
    const doneIdx = editHeader.indexOf('label="Done editing"');
    expect(overflowIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(overflowIdx);
    expect(doneIdx).toBeGreaterThan(deleteIdx);
    expect(editHeader).toContain('variant="menu"');
    expect(editHeader).not.toContain('variant="icon"');
    expect(editSource).toContain("danger: true");
    expect(editHeader).not.toContain("profile-delete-footer");
  });

  test("does not keep Remove profile in the edit-pane body slots", () => {
    expect(paritySlotsSource).not.toContain("ProfileDeleteControls");
  });

  test("keeps a confirm dialog and delete-plugin checkbox, with an icon variant", () => {
    expect(deleteSource).toContain('variant?: "labeled" | "icon" | "menu"');
    expect(deleteSource).toContain("IconActionButton");
    expect(deleteSource).toContain("Trash2");
    expect(deleteSource).toContain('label="Delete profile"');
    expect(deleteSource).toContain('title="Delete this profile?"');
    expect(deleteSource).not.toContain("profile tag");
    expect(deleteSource).toContain("profile-remove-action");
    expect(deleteSource).not.toContain("profile-delete-footer");
    expect(deleteSource).toContain("ConfirmDialog");
    expect(deleteSource).toContain("Also delete it from the Library");
    expect(deleteSource).toContain("confirm-dialog-option");
    expect(deleteSource).not.toContain("text-muted-foreground");
    expect(stylesSource).toContain(".confirm-dialog-extra");
    expect(stylesSource).toContain(".confirm-dialog-option");
    expect(cssBlock(stylesSource, ".confirm-dialog-extra")).toContain("margin-top: 1rem");
    expect(readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/ConfirmDialog.tsx"),
      "utf8",
    )).toContain("confirm-dialog-extra");
  });

  test("puts Delete in the profile page overflow, not beside rail create", () => {
    expect(liveStatusLine).not.toContain("ProfileDeleteControls");
    expect(liveToolbar).toContain("<ProfileHeaderActions");
    expect(appSource).toContain('testId="profile-overflow"');
    expect(appSource).toContain('variant="menu"');
    expect(stylesSource).toContain(".header-more-item.is-danger");
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
    expect(designSource).toContain("distinct option row below the description");
    expect(designSource).toContain("icon-only trash control");
  });
});
