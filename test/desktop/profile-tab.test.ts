import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { AppHeader, type AppHeaderProps } from "../../apps/desktop/src/components/shell/AppHeader.tsx";
import { ProfileScopeSwitch } from "../../apps/desktop/src/components/shell/ProfileScopeSwitch.tsx";
import type { Scope } from "../../apps/desktop/src/lib/api/scope.ts";
import type { Destination } from "../../apps/desktop/src/lib/header-destination.ts";
import {
  GLOBAL_SCOPE_TOOLTIP,
  loadProfileScope,
  PROFILE_TAB_TOOLTIP,
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
      (el) => el.getAttribute("aria-label") === "Browse..." || el.textContent?.includes("Browse..."),
    );
    expect(browse).toBeDefined();
    await act(async () => {
      browse?.click();
    });
    expect(browsed).toBe(1);
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
      /<ChromeTooltip content=\{GLOBAL_SCOPE_TOOLTIP\}>\s*<button[^>]*data-testid="profile-scope-global"/,
    );
    expect(switchSource).toMatch(
      /<ChromeTooltip content=\{projectScopeTooltip\(projectPath\)\}>\s*<button[^>]*data-testid="profile-scope-project"/,
    );
    expect(switchSource).toContain("chevronLabel={SWITCH_PROJECT_TOOLTIP}");
    expect(pickerSource).toMatch(/<ChromeTooltip content=\{chevronLabel\}>/);
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
