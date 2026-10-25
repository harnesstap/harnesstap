import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { EnvironmentsWorkspace } from "../../apps/desktop/src/components/environments/EnvironmentsWorkspace.tsx";
import { CommandRegistryProvider } from "../../apps/desktop/src/state/command-registry.tsx";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { LoadErrorState } from "../../apps/desktop/src/components/LoadErrorState.tsx";
import { ENVIRONMENTS_EMPTY_COPY, loadErrorCopy } from "../../apps/desktop/src/lib/ui-copy.ts";

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

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function text(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

describe("load error copy", () => {
  it("names the noun and points at the agent", () => {
    const copy = loadErrorCopy("environments");
    expect(copy.title).toBe("Couldn't load environments");
    expect(copy.body).toBe("Check that the HarnessTap agent is running, then try again.");
    expect(copy.action).toBe("Retry");
  });
});

describe("load error and empty states", () => {
  let win: Window;
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    win = installDom();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    uninstallDom(win);
  });

  it("LoadErrorState calls onRetry from its single Retry button", async () => {
    let retries = 0;
    await act(async () => {
      root.render(createElement(LoadErrorState, { noun: "harnesses", onRetry: () => { retries += 1; } }));
    });
    const buttons = [...document.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(text()).toContain("Couldn't load harnesses");
    await act(async () => {
      buttons[0]!.click();
    });
    expect(retries).toBe(1);
  });

  function renderEnvironments() {
    return act(async () => {
      root.render(
        createElement(
          CommandRegistryProvider,
          null,
          createElement(
            Tooltip.Provider,
            null,
            createElement(EnvironmentsWorkspace, {
              baseUrl: "http://127.0.0.1:9",
              token: "t",
              connected: true,
              projectPath: null,
              onSuccess: () => {},
            }),
          ),
        ),
      );
    });
  }

  it("Env shows one error state and no create action when the list fails", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch);
    try {
      await renderEnvironments();
      await settle();
      expect(document.querySelector('[data-testid="environments-load-error"]')).not.toBeNull();
      expect(text()).toContain("Couldn't load environments");
      expect(text()).not.toContain(ENVIRONMENTS_EMPTY_COPY.title);
      expect(text()).not.toContain("Click an environment to inspect it.");
      expect(document.querySelector('[data-testid="create-environment"]')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("Env with no rows shows the main-pane empty state, not the inspect hint", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(JSON.stringify({ environments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch);
    try {
      await renderEnvironments();
      await settle();
      expect(document.querySelector('[data-testid="environments-empty"]')).not.toBeNull();
      expect(text()).toContain(ENVIRONMENTS_EMPTY_COPY.body);
      expect(text()).not.toContain("Click an environment to inspect it.");
      expect(text()).not.toContain("Couldn't load");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("profiles and harness load failures", () => {
  const src = (path: string) =>
    readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

  it("Profiles replace the empty state and hide create CTAs when nothing loaded", () => {
    const workspace = src("components/shell/ScopeWorkspace.tsx");
    const rail = src("components/shell/ProfilesRail.tsx");
    expect(workspace).toContain('noun="profiles"');
    expect(workspace).toContain("{profilesLoadFailed ? null : (");
    expect(rail).toContain("{profilesLoadFailed ? null : (");
    expect(rail).not.toContain('title="Could not load profiles"');
  });

  it("Harness drops the banner when the inventory never loaded", () => {
    const workspace = src("components/harnesses/HarnessesWorkspace.tsx");
    expect(workspace).toContain('noun="harnesses"');
    expect(workspace).toContain("ctrl.error && !inventoryLoadFailed");
  });
});
