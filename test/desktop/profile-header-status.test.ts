import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROFILE_HEADER_STATUS_TOOLTIP,
  profileHeaderStatus,
} from "../../apps/desktop/src/lib/reapply.ts";
import { readDesktopShellSource } from "../helpers/desktop-shell-source";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const componentSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/live/ProfileHeaderStatus.tsx",
  ),
  "utf8",
);
const appSource = readDesktopShellSource();
const stylesSource = readDesktopCss();
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

const kinds = ["inactive", "active_applied", "active_not_fully_applied"] as const;

describe("profile header status chrome", () => {
  test("covers the three visual and tooltip states", () => {
    const inactive = profileHeaderStatus({
      selectedProfile: "work",
      activeProfile: "home",
      applied: true,
      view: "home",
      globalDriftStatus: "clean",
    });
    const applied = profileHeaderStatus({
      selectedProfile: "work",
      activeProfile: "work",
      applied: true,
      view: "home",
      globalDriftStatus: "clean",
    });
    const warn = profileHeaderStatus({
      selectedProfile: "work",
      activeProfile: "work",
      applied: false,
      view: "home",
      globalDriftStatus: "clean",
    });

    expect(inactive).toMatchObject({
      kind: "inactive",
      tooltip: PROFILE_HEADER_STATUS_TOOLTIP.inactive,
      warn: false,
    });
    expect(applied).toMatchObject({
      kind: "active_applied",
      tooltip: PROFILE_HEADER_STATUS_TOOLTIP.active_applied,
      warn: false,
    });
    expect(warn).toMatchObject({
      kind: "active_not_fully_applied",
      tooltip: PROFILE_HEADER_STATUS_TOOLTIP.active_not_fully_applied,
      warn: true,
    });

    expect(componentSource).toContain("ChromeTooltip");
    expect(componentSource).toContain("aria-label={tooltip}");
    expect(componentSource).toContain("data-kind={kind}");
    expect(componentSource).toContain("profile-header-status-dot");
    expect(componentSource).toContain("profile-header-status-warn");
    for (const kind of kinds) {
      expect(componentSource).toContain(`case "${kind}":`);
    }
    expect(componentSource).not.toContain("Active · applied");
  });

  test("paints the green disc and yellow overlay from status tokens", () => {
    expect(stylesSource).toContain(".profile-header-status-dot");
    expect(stylesSource).toContain(".profile-header-status-warn");
    expect(stylesSource).toContain(
      '.profile-header-status[data-kind="active_applied"] .profile-header-status-dot',
    );
    expect(stylesSource).toContain(
      '.profile-header-status[data-kind="active_not_fully_applied"] .profile-header-status-dot',
    );
    const appliedDot = stylesSource.slice(
      stylesSource.indexOf(
        '.profile-header-status[data-kind="active_applied"] .profile-header-status-dot',
      ),
      stylesSource.indexOf(
        "}",
        stylesSource.indexOf(
          '.profile-header-status[data-kind="active_applied"] .profile-header-status-dot',
        ),
      ) + 1,
    );
    expect(appliedDot).toContain("background: var(--green)");
    const warnDot = stylesSource.slice(
      stylesSource.indexOf(".profile-header-status-warn {"),
      stylesSource.indexOf("}", stylesSource.indexOf(".profile-header-status-warn {")) +
        1,
    );
    expect(warnDot).toContain("background: var(--yellow)");
    expect(warnDot).toContain("position: absolute");
    expect(warnDot).toContain("top:");
    expect(warnDot).toContain("right:");
  });

  test("drops header subtitle copy and keeps title plus version", () => {
    expect(appSource).toContain("<ProfileHeaderStatus");
    expect(appSource).toContain("profileHeaderStatus(");
    expect(appSource).toContain("className=\"status-title\"");
    expect(appSource).toContain("badge-meta");
    expect(appSource).not.toContain("scope-status-line");
    expect(appSource).not.toContain("status-apply-line");
    expect(appSource).not.toContain("status-description");
    expect(appSource).not.toContain("Active · applied");
    expect(appSource).not.toContain("Selected · not applied");
    expect(designSource).toContain("Active and applied");
    expect(designSource).toContain("Active. Not fully applied.");
    expect(designSource).toContain("No subtitle lines under the name");
  });
});
