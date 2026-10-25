import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { EmptyState } from "../../apps/desktop/src/components/EmptyState.tsx";
import { CLEAR_FILTER_LABEL, noResultsTitle } from "../../apps/desktop/src/lib/empty-copy.ts";
import { discoverListEmptyCopy } from "../../apps/desktop/src/lib/sources-search.ts";
import { readDesktopCss } from "./helpers/desktop-css.ts";

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

describe("filter-miss empty state", () => {
  it("says No matches, keeps the quoted query on one line, and offers Clear filter", async () => {
    let cleared = 0;
    await render(
      createElement(EmptyState, {
        variant: "no-match",
        title: noResultsTitle("search-cloud-plugin"),
        body: "Clear the filter to see every resource.",
        action: {
          label: CLEAR_FILTER_LABEL,
          onClick: () => {
            cleared += 1;
          },
          icon: null,
        },
      }),
    );
    const state = host.querySelector(".empty-state");
    expect(state?.classList.contains("empty-state-no-match")).toBe(true);
    const heading = host.querySelector("h2");
    expect(heading?.textContent).toBe('No matches for "search-cloud-plugin"');
    expect(heading?.querySelector(".empty-state-query")?.textContent).toBe(
      '"search-cloud-plugin"',
    );
    const button = Array.from(host.querySelectorAll("button")).find(
      (node) =>
        node.getAttribute("aria-label") === CLEAR_FILTER_LABEL ||
        node.textContent === CLEAR_FILTER_LABEL,
    );
    expect(button).toBeDefined();
    await act(async () => {
      (button as HTMLButtonElement).click();
    });
    expect(cleared).toBe(1);
  });

  it("leaves other empty states unwrapped and at their usual offset", async () => {
    await render(createElement(EmptyState, { title: 'Nothing named "x" yet' }));
    expect(host.querySelector(".empty-state-no-match")).toBeNull();
    expect(host.querySelector(".empty-state-query")).toBeNull();
  });

  it("places a miss 80px under the filter and never breaks the query mid-word", () => {
    const css = readDesktopCss();
    expect(css).toMatch(/\.empty-state\.empty-state-no-match\s*\{\s*margin-top: calc\(80px - var\(--space-4\)\);/);
    expect(css).toMatch(/\.empty-state-query\s*\{[^}]*white-space: nowrap;/);
  });

  it("uses the same miss copy and top placement in Discover", () => {
    expect(discoverListEmptyCopy({ query: "zzzz-nomatch" })).toEqual({
      message: 'No matches for "zzzz-nomatch"',
      hint: "Clear the filter to see every source.",
      action: "clear-search",
    });
    const css = readDesktopCss();
    expect(css).toMatch(
      /\.sources-workspace \.discover-empty\.empty-state-no-match\s*\{\s*justify-content: flex-start;/,
    );
  });
});
