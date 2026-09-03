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
const liveStatusLine = sliceBetween(
  appSource,
  'className="status-line"',
  "status-subline",
);

describe("profile delete chrome", () => {
  test("places Remove profile in the edit-pane header next to Done", () => {
    const deleteIdx = editHeader.indexOf("ProfileDeleteControls");
    const doneIdx = editHeader.indexOf('aria-label="Done editing"');
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
    expect(deleteSource).toContain("icon-action");
    expect(deleteSource).toContain("Trash2");
    expect(deleteSource).toContain('aria-label="Remove profile"');
    expect(deleteSource).toContain('title="Remove profile"');
    expect(deleteSource).not.toContain("profile-delete-footer");
    expect(deleteSource).toContain("ConfirmDialog");
    expect(deleteSource).toContain("Also delete the plugin from the library");
  });

  test("places the icon control on the live-state header when a profile is selected", () => {
    expect(liveStatusLine).toContain("ProfileDeleteControls");
    expect(liveStatusLine).toContain("selectedProfile");
    expect(liveStatusLine).toContain('variant="icon"');
  });

  test("sizes the labeled header button as a compact cluster control", () => {
    const cluster = cssBlock(stylesSource, ".profile-delete-control .btn");
    expect(cluster).toContain("width: auto");
    expect(cluster).toContain("min-height: 32px");
    expect(cluster).not.toContain("width: 100%");
  });

  test("documents icon Remove profile in the edit header and live-state", () => {
    expect(designSource).toContain("**Remove profile**");
    expect(designSource).toContain("edit-profile header");
    expect(designSource).toContain("live-state header");
    expect(designSource).toContain("delete-plugin checkbox");
    expect(designSource).toContain("icon-only **Remove profile** control appears on the live-state header");
  });
});
