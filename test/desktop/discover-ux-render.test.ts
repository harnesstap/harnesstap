import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { AddToProfileDialog } from "../../apps/desktop/src/components/AddToProfileDialog.tsx";
import { DiscoverSourceErrorBanner } from "../../apps/desktop/src/components/SourcesListPane.tsx";

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

describe("DiscoverSourceErrorBanner", () => {
  it("shows friendly copy, keeps the raw error under Details, and offers Manage marketplaces", async () => {
    let retried = 0;
    let managed = 0;
    await render(
      createElement(DiscoverSourceErrorBanner, {
        error: {
          message: "Couldn't reach acme. Check your connection, then retry.",
          detail: "fetch failed: ECONNREFUSED",
          manageMarketplaces: true,
        },
        disabled: false,
        onRetry: () => {
          retried += 1;
        },
        onManageMarketplaces: () => {
          managed += 1;
        },
      }),
    );
    const banner = document.querySelector('[data-testid="discover-source-error"]');
    expect(banner?.textContent).toContain("Couldn't reach acme.");
    const details = document.querySelector("details.discover-source-error-detail");
    expect(details?.querySelector("summary")?.textContent).toBe("Details");
    expect(details?.querySelector("code")?.textContent).toBe("fetch failed: ECONNREFUSED");
    const buttons = [...document.querySelectorAll("button")];
    const manage = buttons.find((button) => button.textContent?.includes("Manage marketplaces"));
    const retry = buttons.find((button) => button.getAttribute("aria-label") === "Retry");
    expect(manage).toBeDefined();
    expect(retry).toBeDefined();
    await act(async () => {
      manage?.click();
      retry?.click();
    });
    expect(managed).toBe(1);
    expect(retried).toBe(1);
  });
});

describe("AddToProfileDialog", () => {
  it("names the item, defaults the profile, and says nothing is applied", async () => {
    let confirmed = 0;
    await render(
      createElement(AddToProfileDialog, {
        open: true,
        itemName: "lint",
        profileNames: ["work", "home"],
        profileName: "work",
        onProfileChange: () => undefined,
        onConfirm: () => {
          confirmed += 1;
        },
        onCancel: () => undefined,
      }),
    );
    const body = document.body.textContent ?? "";
    expect(body).toContain("Add lint to a profile");
    expect(body).toContain("Apply from the sidebar");
    const select = document.querySelector('[data-testid="add-to-profile-select"]');
    expect(select?.hasAttribute("data-placeholder")).toBe(false);
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add to profile",
    );
    expect(confirm?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      confirm?.click();
    });
    expect(confirmed).toBe(1);
  });

  it("disables Add until a profile is chosen", async () => {
    await render(
      createElement(AddToProfileDialog, {
        open: true,
        itemName: "lint",
        profileNames: ["work"],
        profileName: null,
        onProfileChange: () => undefined,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add to profile",
    );
    expect(confirm?.hasAttribute("disabled")).toBe(true);
    const select = document.querySelector('[data-testid="add-to-profile-select"]');
    expect(select?.hasAttribute("data-placeholder")).toBe(true);
  });
});
