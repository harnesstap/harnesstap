import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHORTCUTS } from "../../apps/desktop/src/lib/commands.ts";
import { marketplaceTypeReadout } from "../../apps/desktop/src/lib/marketplace-type-readout.ts";
import {
  MIGRATE_EXPORT_SCOPE_HEADING,
  MIGRATE_IMPORT_SCOPE_HEADING,
  migrateExportScopeOptions,
  migrateImportScopeOptions,
} from "../../apps/desktop/src/lib/migrate-defaults.ts";
import { destinationForNumberKey } from "../../apps/desktop/src/state/navigation.ts";
import {
  trackedDirectoryKindBadge,
  trackedDirectoryPathLine,
} from "../../apps/desktop/src/lib/tracked-directory-display.ts";

const src = (rel: string) =>
  readFileSync(join(import.meta.dir, "../../apps/desktop/src", rel), "utf8");

describe("migrate drawers", () => {
  it("asks a question and explains every scope option", () => {
    expect(MIGRATE_EXPORT_SCOPE_HEADING).toBe("What do you want to export?");
    expect(MIGRATE_IMPORT_SCOPE_HEADING).toBe("What is in this file?");
    for (const option of [...migrateExportScopeOptions, ...migrateImportScopeOptions]) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description).toMatch(/\.$/);
    }
    expect(migrateExportScopeOptions.map((o) => o.label)).toContain("Full workspace");
  });

  it("uses one Choose file picker with an empty-state line", () => {
    const picker = src("components/MigrateFilePicker.tsx");
    expect(picker).toContain("MIGRATE_CHOOSE_FILE_COPY");
    expect(picker).toContain("MIGRATE_NO_FILE_COPY");
    expect(src("components/MigrateExportDrawer.tsx")).toContain("MigrateFilePicker");
    expect(src("components/MigrateImportDrawer.tsx")).toContain("MigrateFilePicker");
  });
});

describe("tracked directories", () => {
  it("badges only custom entries", () => {
    expect(trackedDirectoryKindBadge({ kind: "custom", path: "/x" } as never)).toBe("Custom");
    expect(trackedDirectoryKindBadge({ kind: "home", path: "~" } as never)).toBe(null);
  });

  it("hides a bare home path line", () => {
    expect(trackedDirectoryPathLine({ kind: "home", path: "/h", display_path: "~" } as never)).toBe(null);
    expect(trackedDirectoryPathLine({ kind: "custom", path: "/h/p", display_path: "~/p" } as never)).toBe("~/p");
  });
});

describe("navigation labels and palette", () => {
  it("binds Ctrl+5 to Profile and lists it in the palette", () => {
    const profile = SHORTCUTS.find((s) => s.id === "profile");
    expect(profile?.key).toBe("5");
    expect(profile?.label).toBe("Go to Profile");
    expect(destinationForNumberKey("5")).toBe("scope");
    expect(src("components/shell/CommandPalette.tsx")).toContain('id: "goto-profile"');
  });

  it("shows the same destination names as the palette", () => {
    expect(src("components/shell/AppHeader.tsx")).toContain('header-focus-label">Harnesses<');
    expect(src("components/parity/ParityChrome.tsx")).toContain('header-focus-label">Environments<');
  });
});

describe("Add marketplace", () => {
  it("shows the inferred type as a read-only value", () => {
    expect(marketplaceTypeReadout("Inferred: Claude Code and Cursor")).toBe("Claude Code and Cursor");
    expect(src("components/MarketplaceEditPanel.tsx")).toContain("Leave empty to track the default branch.");
    expect(src("components/MarketplaceTrackedBranchesField.tsx")).toContain("Enter a URL above to see branches");
  });
});

describe("account and notifications", () => {
  it("uses secondary sign-in buttons with matching section eyebrows", () => {
    const cloud = src("components/CloudAccountDrawer.tsx");
    const github = src("components/GithubSignInSection.tsx");
    expect(cloud).toContain('<div className="eyebrow">Cloud</div>');
    const signIn = (source: string, label: string) => {
      const end = source.indexOf(label);
      return source.slice(source.lastIndexOf("<button", end), end);
    };
    expect(signIn(cloud, '"Sign in to Cloud"}')).toContain('["btn", busy ? "is-busy" : ""]');
    expect(signIn(github, '"Sign in with GitHub"}')).toContain('["btn", busy ? "is-busy" : ""]');
    expect(src("styles/features/settings.css")).toContain(".cloud-account-actions .btn {\n  width: auto;");
  });

  it("keeps the mark-all tooltip reachable and offsets the popover", () => {
    const bell = src("components/shell/NotificationsBell.tsx");
    expect(bell).toContain("aria-disabled={busy || count === 0}");
    expect(bell).toContain("sideOffset={NOTIFICATIONS_POPOVER_OFFSET_PX}");
  });
});
