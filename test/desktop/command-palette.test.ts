import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopShellSource } from "../helpers/desktop-shell-source";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const root = join(import.meta.dir, "../..");
const appSource = readDesktopShellSource();
const designSource = readFileSync(join(root, "apps/desktop/DESIGN.md"), "utf8");
const readmeSource = readFileSync(join(root, "apps/desktop/README.md"), "utf8");
const resourcesSource = readFileSync(
  join(root, "apps/desktop/src/components/ResourcesPanel.tsx"),
  "utf8",
);
const sourcesSource = readFileSync(
  join(root, "apps/desktop/src/components/SourcesWorkspace.tsx"),
  "utf8",
);
const filterSource = readFileSync(
  join(root, "apps/desktop/src/components/ResourceFilterSidebar.tsx"),
  "utf8",
);
const css = readDesktopCss();

describe("command palette wiring", () => {
  test("shell hosts the palette inside the command registry", () => {
    expect(appSource).toContain("CommandRegistryProvider");
    expect(appSource).toContain("CommandPaletteHost");
    expect(appSource).toContain("matchShortcut");
    expect(appSource).toContain('role="listbox"');
    expect(appSource).toContain("Keyboard shortcuts");
  });

  test("workspaces register actions and expose a / filter target", () => {
    expect(resourcesSource).toContain("useRegisterCommands");
    expect(resourcesSource).toContain("Create resource");
    expect(sourcesSource).toContain("useRegisterCommands");
    expect(sourcesSource).toContain("Add marketplace");
    expect(filterSource).toContain("data-workspace-filter");
    expect(appSource).toContain("useRegisterCommands");
  });

  test("DESIGN.md and README document the shortcut contract", () => {
    expect(designSource).toContain("`⌘/Ctrl+K`");
    expect(designSource).toContain("`⌘/Ctrl+1..3`");
    expect(readmeSource).toContain("`⌘/Ctrl+K`");
    expect(readmeSource).toContain("Command palette");
  });

  test("palette CSS uses tokens rather than literal z-index or hex", () => {
    expect(css).toContain(".command-palette");
    expect(css).toContain("var(--text-micro)");
  });
});
