import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { AppHeader, type AppHeaderProps } from "../../apps/desktop/src/components/shell/AppHeader.tsx";
import type { HeaderDestination } from "../../apps/desktop/src/lib/header-destination.ts";
import {
  initialNavigationState,
  type NavigationState,
  navigationReducer,
} from "../../apps/desktop/src/state/navigation.ts";

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
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

describe("header Scope segment", () => {
  let win: Window;
  let host: HTMLElement;
  let root: Root;
  let clicks: HeaderDestination[];

  beforeEach(() => {
    win = installDom();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    clicks = [];
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    uninstallDom(win);
  });

  async function renderHeader(nav: NavigationState): Promise<void> {
    const props: AppHeaderProps = {
      client: null,
      connected: false,
      destination: nav.destination,
      scope: nav.scope,
      switching: false,
      bootstrapBusy: false,
      migrateBusy: false,
      projectPath: "/work/repo",
      projectReady: true,
      cloudAuth: null,
      onDestinationClick: (clicked) => {
        clicks.push(clicked);
      },
      onSelectProject: noop,
      onBrowseProject: noop,
      onOpenMigrateExport: noop,
      onOpenMigrateImport: noop,
      onOpenSettings: noop,
      onOpenAccount: noop,
    };
    await act(async () => {
      root.render(createElement(Tooltip.Provider, { delayDuration: 0 }, createElement(AppHeader, props)));
    });
  }

  function scopeButton(id: "view-global" | "view-project"): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    if (!button) {
      throw new Error(`missing ${id}`);
    }
    return button;
  }

  function go(nav: NavigationState, destination: NavigationState["destination"]): NavigationState {
    return navigationReducer(nav, { type: "go", destination });
  }

  it("shows Global on Harnesses and makes Project an inert, explained button", async () => {
    const projectNav = navigationReducer(initialNavigationState, { type: "set-scope", scope: "project" });
    await renderHeader(go(projectNav, "harnesses"));

    const global = scopeButton("view-global");
    const project = scopeButton("view-project");
    expect(global.getAttribute("aria-pressed")).toBe("true");
    expect(global.className).toBe("on");
    expect(project.getAttribute("aria-pressed")).toBe("false");
    expect(project.getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      project.click();
    });
    expect(clicks).toEqual([]);

    await act(async () => {
      global.click();
    });
    expect(clicks).toEqual(["global"]);
  });

  it("keeps each scoped tab on Project across a Harnesses visit", async () => {
    let nav = navigationReducer(initialNavigationState, { type: "set-scope", scope: "project" });

    for (const destination of ["library", "discover", "environments"] as const) {
      nav = go(nav, destination);
      await renderHeader(nav);
      expect(scopeButton("view-project").getAttribute("aria-pressed")).toBe("true");
      expect(scopeButton("view-project").hasAttribute("aria-disabled")).toBe(false);

      nav = go(nav, "harnesses");
      await renderHeader(nav);
      expect(scopeButton("view-global").getAttribute("aria-pressed")).toBe("true");

      nav = go(nav, destination);
      await renderHeader(nav);
      expect(scopeButton("view-project").getAttribute("aria-pressed")).toBe("true");
      expect(scopeButton("view-global").getAttribute("aria-pressed")).toBe("false");

      await act(async () => {
        scopeButton("view-project").click();
      });
      expect(clicks.at(-1)).toBe("project");
    }
  });
});
