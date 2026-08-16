import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const paritySource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/parity/ParityChrome.tsx"),
  "utf8",
);

describe("desktop header chrome", () => {
  test("does not render a sidecar connected glyph", () => {
    expect(appSource).not.toContain("connection-indicator");
    expect(appSource).not.toMatch(/\bUnplug\b/);
  });

  test("keeps a connected test hook for e2e readiness", () => {
    expect(appSource).toContain('"agent-connected"');
  });

  test("exposes Library instead of Resources as a workspace destination", () => {
    expect(appSource).toContain('aria-label="Library"');
    expect(appSource).toContain('setWorkspaceFocus("library")');
    expect(appSource).not.toContain('setWorkspaceFocus("resources")');
    expect(appSource).not.toContain('setWorkspaceFocus("plugins")');
  });

  test("does not put Plugins or Apply plugin in the header", () => {
    expect(paritySource).not.toContain('aria-label="Plugins"');
    expect(paritySource).not.toContain('aria-label="Apply plugin"');
    expect(paritySource).not.toContain("ApplyPluginDrawer");
    expect(paritySource).toContain('aria-label="Environments"');
  });

  test("refreshes live status after package Apply and shows success in the header", () => {
    const refreshOnProfiles =
      appSource.match(/void refreshProfiles\(\);\s*void refreshStatus\("full"\);/g) ?? [];
    expect(refreshOnProfiles.length).toBeGreaterThanOrEqual(2);
    expect(appSource).toContain("header-status");
    expect(appSource).toContain("success-flash");
  });
});

describe("desktop library workspace", () => {
  test("does not render Items or Packages library tabs", () => {
    expect(appSource).not.toContain("LibraryTab");
    expect(appSource).not.toContain("LibraryWorkspace");
    expect(appSource).toContain("ResourcesPanel");
    expect(appSource).not.toContain('setLibraryTab("packages")');
  });
});
