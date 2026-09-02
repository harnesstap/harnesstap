import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "../../apps/desktop/src");
const editSource = readFileSync(join(root, "components/EditProfilePane.tsx"), "utf8");
const compositionSource = readFileSync(
  join(root, "components/CompositionPickers.tsx"),
  "utf8",
);
const paritySlotsSource = readFileSync(
  join(root, "components/parity/EditProfileParitySlots.tsx"),
  "utf8",
);
const envFieldSource = readFileSync(
  join(root, "components/parity/DefaultEnvironmentField.tsx"),
  "utf8",
);
const publishSource = readFileSync(
  join(root, "components/parity/PublishProfileDrawer.tsx"),
  "utf8",
);
const appSource = readFileSync(join(root, "App.tsx"), "utf8");
const stylesSource = readFileSync(join(root, "styles.css"), "utf8");
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("profile edit resource inspect", () => {
  test("resource rows inspect on activate without routing the checkbox through htmlFor", () => {
    expect(compositionSource).toContain("onInspect");
    expect(compositionSource).toContain("resource-row-checkbox");
    expect(compositionSource).toContain("event.stopPropagation()");
    expect(editSource).toContain("onInspectResource");
    expect(editSource).toContain("ResourceDetailPane");
    const picker = sliceBetween(
      compositionSource,
      "function ResourcePickerRow",
      "export function ResourceSelectionList",
    );
    expect(picker).toContain("onOpen={inspect}");
    expect(picker).toContain("resource-row-checkbox");
  });

  test("keeps resource-row grid rules and balanced braces in styles.css", () => {
    const opens = stylesSource.match(/\{/g)?.length ?? 0;
    const closes = stylesSource.match(/\}/g)?.length ?? 0;
    expect(opens).toBe(closes);
    expect(stylesSource).toContain(".resource-row {\n  display: grid;");
    expect(stylesSource.match(/\.resource-row-clickable \{/g)?.length).toBe(1);
    expect(stylesSource.match(/\.resource-row-checkbox \{/g)?.length).toBe(1);
  });
});

describe("profile edit publish chrome", () => {
  test("puts the publish trigger in the Profiles rail next to create, not in the edit footer", () => {
    const rail = sliceBetween(
      appSource,
      "profiles-rail-toolbar",
      "open-create-profile",
    );
    expect(rail).toContain("PublishProfileDrawer");
    expect(rail).toContain('triggerClassName="icon-action rail-icon-action"');
    expect(paritySlotsSource).not.toContain("PublishProfileDrawer");
    expect(editSource).not.toContain("PublishProfileDrawer");
  });

  test("opens a catalog-picker dialog with select-all, memory, and a disabled Publish when none are registered", () => {
    expect(publishSource).toContain("publish-profile-dialog");
    expect(publishSource).not.toContain("FullScreenPanel");
    expect(publishSource).toContain("All catalogs");
    expect(publishSource).toContain("no catalog registered");
    expect(publishSource).toContain("noCatalogRegistered");
    expect(publishSource).toContain("readRememberedCatalogKeys");
    expect(publishSource).toContain("writeRememberedCatalogKeys");
    expect(publishSource).toContain("checkAllCheckboxState");
    expect(designSource).toContain("no catalog registered");
  });

  test("removes the Advanced catalog accordion from the edit form", () => {
    expect(paritySlotsSource).not.toContain("ProfileCatalogBindings");
    expect(editSource).not.toContain("<summary>Advanced</summary>");
    expect(editSource).not.toContain("profile-catalog-bindings");
  });
});

describe("profile edit default environment chrome", () => {
  test("places Clear as an icon to the left of the dropdown", () => {
    const row = sliceBetween(
      envFieldSource,
      'className="flex items-center gap-2"',
      "</Select>",
    );
    const clearIdx = row.indexOf("default-environment-clear");
    const selectIdx = row.indexOf("<Select");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(clearIdx);
    expect(envFieldSource).toContain('aria-label="Clear"');
    expect(envFieldSource).not.toContain("text-btn");
  });

  test("includes None and Create a new environment in the dropdown", () => {
    expect(envFieldSource).toContain("DEFAULT_ENV_NONE");
    expect(envFieldSource).toContain("Create a new environment");
    expect(envFieldSource).toContain("DEFAULT_ENV_CREATE");
    expect(envFieldSource).toContain("<Plus");
    expect(envFieldSource).toContain("onCreateEnvironment");
    expect(envFieldSource).not.toContain("Create or manage environments");
  });

  test("deletes the default-environment helper sentence", () => {
    expect(envFieldSource).not.toContain(
      "Used on apply when this profile is the root",
    );
    expect(envFieldSource).not.toContain(
      "Does not change the home active environment",
    );
  });
});
