import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { AppHeader, type AppHeaderProps } from "../../apps/desktop/src/components/shell/AppHeader.tsx";
import { OPEN_ANOTHER_PROJECT_TOOLTIP } from "../../apps/desktop/src/components/ProjectPicker.tsx";
import { ProfileScopeSwitch } from "../../apps/desktop/src/components/shell/ProfileScopeSwitch.tsx";
import type { Scope } from "../../apps/desktop/src/lib/api/scope.ts";
import type { Destination } from "../../apps/desktop/src/lib/header-destination.ts";
import {
  GLOBAL_SCOPE_TOOLTIP,
  loadProfileScope,
  PROFILE_SCOPE_SWITCH,
  PROFILE_SCOPE_SWITCH_WIDTH,
  PROFILE_TAB_TOOLTIP,
  profileScopeTooltipOffsets,
  projectScopeLabel,
  projectScopeTooltip,
  SWITCH_PROJECT_TOOLTIP,
  saveProfileScope,
} from "../../apps/desktop/src/lib/profile-scope.ts";
import { rememberProject } from "../../apps/desktop/src/lib/recent-projects.ts";
import {
  initialNavigationState,
  navigationReducer,
  restoredNavigationState,
  useNavigation,
} from "../../apps/desktop/src/state/navigation.ts";

const DESKTOP_SRC = join(import.meta.dir, "../../apps/desktop/src");
const headerSource = readFileSync(join(DESKTOP_SRC, "components/shell/AppHeader.tsx"), "utf8");
const switchSource = readFileSync(join(DESKTOP_SRC, "components/shell/ProfileScopeSwitch.tsx"), "utf8");
const pickerSource = readFileSync(join(DESKTOP_SRC, "components/ProjectPicker.tsx"), "utf8");
const shellCss = readFileSync(join(DESKTOP_SRC, "styles/features/shell.css"), "utf8");

/** Bodies of the CSS rules whose selector is exactly `selector` (not part of a list). */
function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [...shellCss.matchAll(new RegExp(`(?:\\}|\\*/)\\s*${escaped} \\{([^}]*)\\}`, "g"))].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`no CSS rule for ${selector}`);
  return bodies.join("\n");
}

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "HTMLElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "SVGElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLDivElement",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getSelection",
  "DOMParser",
  "NodeFilter",
  "Range",
  "Text",
  "Comment",
  "HTMLFormElement",
  "HTMLLabelElement",
  "HTMLHeadingElement",
  "HTMLParagraphElement",
  "HTMLSpanElement",
  "HTMLAnchorElement",
  "HTMLImageElement",
  "ShadowRoot",
  "CSSStyleDeclaration",
  "ResizeObserver",
] as const;

function installDom(): Window {
  const win = new Window({ url: "http://127.0.0.1/" });
  const target = globalThis as unknown as Record<string, unknown>;
  const source = win as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    target[key] = key === "window" ? win : source[key];
  }
  target.IS_REACT_ACT_ENVIRONMENT = true;
  return win;
}

function uninstallDom(win: Window): void {
  win.close();
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    delete target[key];
  }
}

function noop(): void {}

let win: Window;
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  win = installDom();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  uninstallDom(win);
});

async function render(node: unknown): Promise<void> {
  await act(async () => {
    root.render(createElement(Tooltip.Provider, { delayDuration: 0 }, node as never));
  });
}

function byTestId<T extends HTMLElement = HTMLButtonElement>(id: string): T {
  const el = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!el) {
    throw new Error(`missing ${id}`);
  }
  return el;
}

/**
 * ChromeTooltip opens after a short pointer hover. Radix picks its portal
 * mount effect when the module loads, before happy-dom exists, so the content
 * never reaches the DOM here; the trigger state proves the tooltip opened and
 * the source checks below pin which text each trigger shows.
 */
async function hoverOpensTooltip(trigger: HTMLElement): Promise<boolean> {
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  const opened = trigger.getAttribute("data-state") !== "closed" && trigger.hasAttribute("aria-describedby");
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
  });
  return opened;
}

const TABS: Array<{ destination: Destination; ariaLabel: string; label: string }> = [
  { destination: "library", ariaLabel: "Library", label: "Library" },
  { destination: "discover", ariaLabel: "Discover", label: "Discover" },
  { destination: "environments", ariaLabel: "Environments", label: "Env" },
  { destination: "harnesses", ariaLabel: "Harnesses", label: "Harness" },
  { destination: "scope", ariaLabel: "Profile", label: "Profile" },
];

describe("header tabs", () => {
  let clicks: Destination[];

  beforeEach(() => {
    clicks = [];
  });

  async function renderHeader(destination: Destination): Promise<void> {
    const props: AppHeaderProps = {
      client: null,
      connected: false,
      destination,
      switching: false,
      migrateBusy: false,
      cloudAuth: null,
      onDestinationClick: (clicked) => {
        clicks.push(clicked);
      },
      onOpenMigrateExport: noop,
      onOpenMigrateImport: noop,
      onOpenSettings: noop,
      onOpenAccount: noop,
    };
    await render(createElement(AppHeader, props));
  }

  it("renders five tabs in order with no header scope control", async () => {
    await renderHeader("library");
    const labels = [...document.querySelectorAll(".header-focus-controls .header-focus-label")].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(TABS.map((tab) => tab.label));
    expect(document.querySelector('[data-testid="view-global"]')).toBeNull();
    expect(document.querySelector('[data-testid="view-project"]')).toBeNull();
    expect(document.querySelector(".header-scope")).toBeNull();
    expect(document.body.textContent).not.toContain("Scope");
  });

  it("marks exactly one tab active for every destination", async () => {
    for (const tab of TABS) {
      await renderHeader(tab.destination);
      const current = [...document.querySelectorAll('.header-focus-controls [aria-current="page"]')];
      expect(current.map((el) => el.getAttribute("aria-label"))).toEqual([tab.ariaLabel]);
      expect(document.querySelectorAll(".header-focus-controls .header-focus-btn.on").length).toBe(1);
    }
  });

  it("Profile tab opens the profile view and explains itself", async () => {
    await renderHeader("library");
    const profile = byTestId("nav-profile");
    expect(profile.getAttribute("aria-label")).toBe("Profile");
    expect(await hoverOpensTooltip(profile)).toBe(true);
    await act(async () => {
      profile.click();
    });
    expect(clicks).toEqual(["scope"]);
  });
});

describe("Profile scope switch", () => {
  let selected: Scope[];
  let picked: string[];
  let browsed: number;

  beforeEach(() => {
    selected = [];
    picked = [];
    browsed = 0;
  });

  async function renderSwitch(scope: Scope, projectPath: string): Promise<void> {
    await render(
      createElement(ProfileScopeSwitch, {
        scope,
        projectPath,
        disabled: false,
        onSelectScope: (next: Scope) => {
          selected.push(next);
        },
        onPickProject: (path: string) => {
          picked.push(path);
        },
        onBrowseProject: () => {
          browsed += 1;
        },
      }),
    );
  }

  it("shows Global and Project: <name> with exactly one pressed", async () => {
    await renderSwitch("global", "/work/acme-app");
    expect(byTestId("profile-scope-global").getAttribute("aria-pressed")).toBe("true");
    expect(byTestId("profile-scope-project").getAttribute("aria-pressed")).toBe("false");
    expect(byTestId("profile-scope-project").textContent).toBe("Project: acme-app");

    await renderSwitch("project", "/work/acme-app");
    expect(byTestId("profile-scope-global").getAttribute("aria-pressed")).toBe("false");
    expect(byTestId("profile-scope-project").getAttribute("aria-pressed")).toBe("true");
  });

  it("every control opens a tooltip on hover", async () => {
    await renderSwitch("global", "/work/acme-app");
    for (const id of ["profile-scope-global", "profile-scope-project", "project-path"]) {
      expect(await hoverOpensTooltip(byTestId(id))).toBe(true);
    }
    await renderSwitch("global", "");
    expect(await hoverOpensTooltip(byTestId("profile-scope-project"))).toBe(true);
  });

  it("Project with a project set selects Project scope", async () => {
    await renderSwitch("global", "/work/acme-app");
    await act(async () => {
      byTestId("profile-scope-project").click();
    });
    expect(selected).toEqual(["project"]);
    await act(async () => {
      byTestId("profile-scope-global").click();
    });
    expect(selected).toEqual(["project", "global"]);
  });

  it("Project with no project set opens the project dropdown instead", async () => {
    rememberProject("/work/other-repo");
    await renderSwitch("global", "");
    expect(byTestId("profile-scope-project").textContent).toBe("Project");
    expect(byTestId("project-path").getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      byTestId("profile-scope-project").click();
    });
    expect(selected).toEqual([]);
    expect(byTestId("project-path").getAttribute("aria-expanded")).toBe("true");
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.textContent).toContain("other-repo");
  });

  it("chevron opens the dropdown; picking or browsing reports back", async () => {
    rememberProject("/work/other-repo");
    await renderSwitch("global", "/work/acme-app");
    await act(async () => {
      byTestId("project-path").click();
    });
    expect(byTestId("project-path").getAttribute("aria-expanded")).toBe("true");
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
      el.textContent?.includes("other-repo"),
    );
    expect(row).toBeDefined();
    await act(async () => {
      row?.click();
    });
    expect(picked).toEqual(["/work/other-repo"]);

    await act(async () => {
      byTestId("project-path").click();
    });
    const browse = [...document.querySelectorAll<HTMLButtonElement>(".project-picker-footer button")].find(
      (el) => el.getAttribute("aria-label") === OPEN_ANOTHER_PROJECT_TOOLTIP,
    );
    expect(browse).toBeDefined();
    await act(async () => {
      browse?.click();
    });
    expect(browsed).toBe(1);
  });
});

describe("Profile scope switch geometry", () => {
  async function renderSwitch(scope: Scope, projectPath: string): Promise<HTMLElement> {
    await render(
      createElement(ProfileScopeSwitch, {
        scope,
        projectPath,
        onSelectScope: () => {},
        onPickProject: () => {},
        onBrowseProject: () => {},
      }),
    );
    return byTestId("profile-scope-switch");
  }

  const LONG = "/work/a-really-long-project-folder-name-that-will-never-fit-in-the-switch";

  it("has one fixed outer width", () => {
    const { globalWidth, projectWidth, chevronWidth, gap, padding, border } = PROFILE_SCOPE_SWITCH;
    expect(PROFILE_SCOPE_SWITCH_WIDTH).toBe(2 * (border + padding) + globalWidth + gap + projectWidth);
    expect(projectWidth).toBeGreaterThan(chevronWidth + globalWidth);
  });

  it("keeps the same sizing in Global, Project, long name, no project and dropdown open", async () => {
    const shapes: string[] = [];
    const shapeOf = (root: HTMLElement) =>
      JSON.stringify({
        style: root.getAttribute("style"),
        classes: [
          ...root.querySelectorAll(
            ".profile-scope-global, .profile-scope-project, .profile-scope-project-option, .project-picker-trigger",
          ),
        ].map((el) => (el.getAttribute("class") ?? "").replace(/\s*\bon\b/g, "")),
      });
    shapes.push(shapeOf(await renderSwitch("global", "/work/acme-app")));
    shapes.push(shapeOf(await renderSwitch("project", "/work/acme-app")));
    shapes.push(shapeOf(await renderSwitch("project", LONG)));
    shapes.push(shapeOf(await renderSwitch("global", "")));
    const root = await renderSwitch("global", "/work/acme-app");
    await act(async () => {
      byTestId("project-path").click();
    });
    expect(byTestId("project-path").getAttribute("aria-expanded")).toBe("true");
    shapes.push(shapeOf(root));
    expect(JSON.parse(shapes[0]).classes).toEqual([
      "profile-scope-option profile-scope-global",
      "profile-scope-project",
      "profile-scope-option profile-scope-project-option",
      "project-picker-trigger is-chevron",
    ]);
    expect(new Set(shapes).size).toBe(1);
    expect(root.getAttribute("style")).toContain(`--profile-scope-project-w: ${PROFILE_SCOPE_SWITCH.projectWidth}px`);
  });

  it("keeps the full long name in the label and the tooltip, with the chevron after it", async () => {
    await renderSwitch("project", LONG);
    const label = byTestId("profile-scope-project-label");
    expect(label.textContent).toBe("Project: a-really-long-project-folder-name-that-will-never-fit-in-the-switch");
    expect(projectScopeTooltip(LONG)).toBe(
      "Project profile for a-really-long-project-folder-name-that-will-never-fit-in-the-switch",
    );
    const segment = byTestId("profile-scope-switch").querySelector(".profile-scope-project");
    expect(segment?.lastElementChild?.querySelector('[data-testid="project-path"]')).not.toBeNull();
  });

  it("CSS fixes both segment widths, truncates the name and keeps weight constant", () => {
    expect(cssRule(".profile-scope-switch")).toMatch(/width: calc\(/);
    expect(cssRule(".profile-scope-switch")).toMatch(/flex: none/);
    expect(cssRule(".profile-scope-global")).toContain("width: var(--profile-scope-global-w)");
    expect(cssRule(".profile-scope-project")).toContain("width: var(--profile-scope-project-w)");
    expect(cssRule(".profile-scope-project-option")).toContain(
      "width: calc(var(--profile-scope-project-w) - var(--profile-scope-chevron-w))",
    );
    expect(cssRule(".project-picker-trigger.is-chevron")).toContain("width: var(--profile-scope-chevron-w)");
    const label = cssRule(".profile-scope-project-label");
    expect(label).toContain("text-overflow: ellipsis");
    expect(label).toContain("overflow: hidden");
    expect(label).toContain("white-space: nowrap");
    const onRules = [...shellCss.matchAll(/(?:^|\n)([^{}\n][^{}]*\.on[^{}]*)\{([^}]*)\}/g)]
      .filter((m) => m[1].includes("profile-scope"))
      .map((m) => m[2]);
    expect(onRules.length).toBeGreaterThan(0);
    for (const body of onRules) {
      expect(body).not.toMatch(/padding|width|border:|margin/);
    }
  });

  it("marks the active segment with a stronger fill, a ring and medium-weight text", () => {
    const base = shellCss.match(/\.profile-scope-option,\s*\.project-picker-trigger\.is-chevron \{([^}]*)\}/)?.[1] ?? "";
    expect(base).toContain("font-weight: 400");
    const fill = shellCss.match(/\.profile-scope-option\.on,\s*\.profile-scope-project\.on \{([^}]*)\}/)?.[1] ?? "";
    expect(fill).toContain("background: var(--surface-selected)");
    expect(fill).toContain("box-shadow: inset 0 0 0 1px var(--border-strong)");
    const weight =
      shellCss.match(/\.profile-scope-option\.on,\s*\.profile-scope-project\.on \.profile-scope-option \{([^}]*)\}/)?.[1] ?? "";
    expect(weight).toContain("font-weight: 500");
  });

  it("puts the active class and pressed state on the selected segment only", async () => {
    const root = await renderSwitch("global", "/work/acme-app");
    expect(root.querySelector(".profile-scope-global")?.classList.contains("on")).toBe(true);
    expect(root.querySelector(".profile-scope-project")?.classList.contains("on")).toBe(false);
    expect(byTestId("profile-scope-global").getAttribute("aria-pressed")).toBe("true");
    expect(byTestId("profile-scope-project").getAttribute("aria-pressed")).toBe("false");
    const project = await renderSwitch("project", "/work/acme-app");
    expect(project.querySelector(".profile-scope-global")?.classList.contains("on")).toBe(false);
    expect(project.querySelector(".profile-scope-project")?.classList.contains("on")).toBe(true);
    expect(byTestId("profile-scope-project").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens every switch tooltip to the right of the switch, clear of the title", () => {
    const offsets = profileScopeTooltipOffsets();
    const { chevronWidth, projectWidth, gap } = PROFILE_SCOPE_SWITCH;
    expect(offsets.project - offsets.chevron).toBe(chevronWidth);
    expect(offsets.global - offsets.chevron).toBe(gap + projectWidth);
    expect(switchSource).toMatch(/content=\{GLOBAL_SCOPE_TOOLTIP\} side="right" sideOffset=\{TOOLTIP_OFFSETS\.global\}/);
    expect(switchSource).toMatch(/side="right"\s+sideOffset=\{TOOLTIP_OFFSETS\.project\}/);
    expect(switchSource).toContain('chevronTooltipSide="right"');
    expect(switchSource).toContain("chevronTooltipOffset={TOOLTIP_OFFSETS.chevron}");
  });
});

describe("project dropdown", () => {
  async function openDropdown(projectPath: string) {
    await render(
      createElement(ProfileScopeSwitch, {
        scope: "project",
        projectPath,
        onSelectScope: () => {},
        onPickProject: () => {},
        onBrowseProject: () => {},
      }),
    );
    await act(async () => {
      byTestId("project-path").click();
    });
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  it("shows a check and aria-selected on the current project row only", async () => {
    rememberProject("/work/other-repo");
    rememberProject("/work/acme-app");
    const rows = await openDropdown("/work/acme-app");
    expect(rows.length).toBe(2);
    const current = rows.find((el) => el.textContent?.includes("acme-app"));
    const other = rows.find((el) => el.textContent?.includes("other-repo"));
    expect(current?.getAttribute("aria-selected")).toBe("true");
    expect(other?.getAttribute("aria-selected")).toBe("false");
    expect(current?.querySelectorAll('[data-testid="project-picker-current-check"]').length).toBe(1);
    expect(other?.querySelector('[data-testid="project-picker-current-check"]')).toBeNull();
    expect(document.querySelectorAll('[data-testid="project-picker-current-check"]').length).toBe(1);
  });

  it("has no check when no recent project is the current one", async () => {
    rememberProject("/work/other-repo");
    await openDropdown("");
    expect(document.querySelector('[data-testid="project-picker-current-check"]')).toBeNull();
  });

  it("styles hover differently from the current row", () => {
    expect(shellCss).toMatch(/\.project-picker-item:hover \{\s*background: var\(--surface-hover\);/);
    expect(shellCss).toMatch(
      /\.project-picker-item\.selected,\s*\.project-picker-item\.selected:hover \{\s*background: var\(--surface-selected\);/,
    );
  });

  it("labels the footer folder button Open another project", async () => {
    expect(OPEN_ANOTHER_PROJECT_TOOLTIP).toBe("Open another project");
    expect(pickerSource).toContain("label={OPEN_ANOTHER_PROJECT_TOOLTIP}");
    await openDropdown("/work/acme-app");
    const footer = document.querySelectorAll<HTMLButtonElement>(".project-picker-footer button");
    expect(footer.length).toBe(1);
    expect(footer[0].getAttribute("aria-label")).toBe("Open another project");
  });
});

describe("tooltip copy", () => {
  it("uses the exact tooltip text", () => {
    expect(PROFILE_TAB_TOOLTIP).toBe("Your Global and Project profiles");
    expect(GLOBAL_SCOPE_TOOLTIP).toBe("Global profile. Used in every project.");
    expect(projectScopeTooltip("/work/acme-app")).toBe("Project profile for acme-app");
    expect(projectScopeTooltip("")).toBe("Pick a project");
    expect(SWITCH_PROJECT_TOOLTIP).toBe("Switch project");
  });

  it("wires each tooltip to its control", () => {
    expect(headerSource).toMatch(
      /<ChromeTooltip content=\{PROFILE_TAB_TOOLTIP\}>\s*<button[^>]*data-testid="nav-profile"/,
    );
    expect(switchSource).toMatch(
      /<ChromeTooltip content=\{GLOBAL_SCOPE_TOOLTIP\}[^>]*>\s*<button[^>]*data-testid="profile-scope-global"/,
    );
    expect(switchSource).toMatch(
      /<ChromeTooltip\s+content=\{projectScopeTooltip\(projectPath\)\}[^>]*>\s*<button[^>]*data-testid="profile-scope-project"/,
    );
    expect(switchSource).toContain("chevronLabel={SWITCH_PROJECT_TOOLTIP}");
    expect(pickerSource).toMatch(/<ChromeTooltip\s+content=\{chevronLabel\}/);
  });

  it("has no em dashes, en dashes or Unicode ellipses", () => {
    const all = [
      PROFILE_TAB_TOOLTIP,
      GLOBAL_SCOPE_TOOLTIP,
      SWITCH_PROJECT_TOOLTIP,
      projectScopeTooltip("/a/b"),
      projectScopeTooltip(""),
      projectScopeLabel("/a/b"),
      projectScopeLabel(""),
    ].join("\n");
    expect(all).not.toMatch(/[\u2013\u2014\u2026]/);
    expect(projectScopeTooltip("C:\\work\\repo")).toBe("Project profile for repo");
  });
});

describe("remembered scope", () => {
  it("first run defaults to Global", () => {
    expect(loadProfileScope()).toBe("global");
    expect(restoredNavigationState()).toEqual(initialNavigationState);
  });

  it("restores Project only when a project is known", () => {
    saveProfileScope("project");
    expect(loadProfileScope()).toBe("global");
    rememberProject("/work/acme-app");
    expect(loadProfileScope()).toBe("project");
    expect(restoredNavigationState().scope).toBe("project");
    saveProfileScope("global");
    expect(loadProfileScope()).toBe("global");
  });

  it("falls back to Global when storage throws", () => {
    const original = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => {
      throw new Error("denied");
    };
    try {
      expect(loadProfileScope()).toBe("global");
    } finally {
      localStorage.getItem = original;
    }
  });

  it("remembers the scope across a restart and across tab switches", async () => {
    rememberProject("/work/acme-app");
    let nav: ReturnType<typeof useNavigation> | null = null;
    function Probe() {
      nav = useNavigation();
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(nav?.scope).toBe("global");
    await act(async () => {
      nav?.setScope("project");
    });
    for (const destination of ["library", "harnesses", "discover", "environments", "scope"] as const) {
      await act(async () => {
        nav?.go(destination);
      });
      expect(nav?.scope).toBe("project");
    }

    // Restart: a fresh tree reads the persisted scope.
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    nav = null;
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(nav?.scope).toBe("project");
    expect(nav?.destination).toBe("scope");

    await act(async () => {
      nav?.setScope("global");
    });
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(nav?.scope).toBe("global");
  });

  it("scope changes never move the active tab", () => {
    const state = navigationReducer(
      navigationReducer(initialNavigationState, { type: "go", destination: "library" }),
      { type: "set-scope", scope: "project" },
    );
    expect(state.destination).toBe("library");
  });
});
