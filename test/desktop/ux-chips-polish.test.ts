import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  formatResourceDisplayName,
  instructionHarnessParts,
} from "../../apps/desktop/src/lib/resource-display";
import { statusPillLabel } from "../../apps/desktop/src/components/StatusPill";
import { CONNECT_SPLASH_COPY } from "../../apps/desktop/src/lib/ui-copy";

const desktopSrc = join(import.meta.dir, "../../apps/desktop/src");
const read = (path: string) => readFileSync(join(desktopSrc, path), "utf8");

describe("instruction chips (P2-18)", () => {
  it("splits a harness instruction into the file name and its harness", () => {
    const resource = {
      type: "instruction",
      name: "claude-instructions",
      source: "/tmp/project/CLAUDE.md",
    };
    expect(formatResourceDisplayName(resource)).toBe("CLAUDE.md (Claude Code)");
    expect(instructionHarnessParts(resource)).toEqual({
      file: "CLAUDE.md",
      harnessId: "claude-code",
      harnessName: "Claude Code",
    });
  });

  it("keeps the full label for shared, namespaced and non-instruction resources", () => {
    expect(
      instructionHarnessParts({ type: "instruction", name: "agents-instructions", source: "AGENTS.md" }),
    ).toBeNull();
    expect(
      instructionHarnessParts({
        type: "instruction",
        name: "cursor-instructions",
        source: ".cursorrules",
        namespace: "project",
      }),
    ).toBeNull();
    expect(instructionHarnessParts({ type: "skill", name: "claude-instructions" })).toBeNull();
  });

  it("renders the bare file name with a harness icon and keeps the full accessible name", () => {
    const row = read("components/live/InventoryRow.tsx");
    expect(row).toContain("instructionHarnessParts(item.resource)");
    expect(row).toContain("aria-label={instructionParts ? item.label : undefined}");
    expect(row).toContain('data-testid="inventory-chip-instruction-harness"');
  });
});

describe("status pill (P1-18)", () => {
  it("uses one label per state", () => {
    expect(statusPillLabel("active")).toBe("Active");
    expect(statusPillLabel("inactive")).toBe("Inactive");
    expect(statusPillLabel("not-in-profile")).toBe("Not in profile");
  });

  it("replaces the ad hoc active badges", () => {
    expect(read("components/EditProfilePane.tsx")).toContain('<StatusPill kind="active" />');
    expect(read("components/EditProfilePane.tsx")).not.toContain("edit-active-badge");
    expect(read("components/environments/EnvironmentsWorkspace.tsx")).not.toContain(
      '<span className="badge">active</span>',
    );
  });
});

describe("reconnect banner (P1-19, P2-16)", () => {
  it("is neutral with a spinner and plain copy", () => {
    const splash = read("components/shell/ConnectSplash.tsx");
    expect(splash).toContain('tone="neutral"');
    expect(splash).toContain("<ButtonSpinner");
    expect(CONNECT_SPLASH_COPY.reconnecting).toBe("Reconnecting to the HarnessTap agent...");
  });
});

describe("chrome polish (P1-25, P2-1, P2-2, P2-3, P2-5, P2-19)", () => {
  const library = read("styles/features/library.css");

  it("gives harness icons a real tooltip instead of a title attribute", () => {
    const icons = read("components/HarnessIcons.tsx");
    expect(icons).toContain("<ChromeTooltip content={name}>");
    expect(read("components/ui/resource-row.tsx")).not.toContain("tooltip={false}");
  });

  it("underlines resource names only on hover or focus", () => {
    expect(library).toMatch(/\.resource-name-btn \{[^}]*text-decoration: none;/);
    expect(library).toMatch(/\.resource-name-btn:hover[^{]*\{[^}]*text-decoration: underline;/);
  });

  it("aligns type chips with the filter input and centers row checkboxes on the first line", () => {
    expect(library).toMatch(/\.resource-type-tabs-scroller \{[^}]*padding: 0\.15rem 0;/);
    expect(library).toMatch(/\.resource-row-checkbox \{[^}]*height: 22px;[^}]*align-items: center;/);
  });

  it("puts the version right after the name as vX.Y.Z", () => {
    const detail = read("components/PluginPackageDetail.tsx");
    expect(detail).toContain("`v${detail.plugin.version}`");
    expect(detail).not.toContain("`@${detail.plugin.version}`");
    expect(read("components/LiveStatePanel.tsx")).toContain("v{plugin.version}");
  });

  it("styles the type overflow as a pill button", () => {
    expect(library).toMatch(/\.resource-type-tabs-more \{[^}]*border-radius: 999px;/);
  });
});
