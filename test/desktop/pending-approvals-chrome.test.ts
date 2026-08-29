import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const stripSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/PendingApprovalsStrip.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("desktop pending approvals chrome", () => {
  test("live pane uses the yellow banner strip with approve/deny or hint", () => {
    expect(appSource).toContain("PendingApprovalsStrip");
    expect(appSource).toContain("shouldShowPendingApprovalsStrip");
    expect(stripSource).toContain('data-testid="pending-approvals"');
    expect(stripSource).toContain('className="banner"');
    expect(stripSource).toContain('className="pill warn"');
    expect(stripSource).toContain("yellow");
    expect(stripSource).toContain("Approve");
    expect(stripSource).toContain("Deny");
    expect(stripSource).toContain("pendingApprovalCliHint");
  });

  test("Project workspace has a labeled Install control that posts empty plugins", () => {
    expect(appSource).toContain('data-testid="project-install"');
    expect(appSource).toContain("Installed project from apm.yml");
    expect(appSource).toContain("plugins: []");
    expect(appSource).toContain('scope: "project"');
    expect(appSource).not.toMatch(/data-testid="project-install"[\s\S]{0,400}Sync/);
    expect(designSource).toContain("Project **Install**");
    expect(designSource).toContain("pending-approvals strip");
  });

  test("empty project-profile copy points at apm.yml not config.toml", () => {
    expect(appSource).toContain('<span className="mono">apm.yml</span>');
    expect(appSource).not.toContain(".harnesstap/config.toml");
  });
});
