import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import {
  act,
  createElement,
  useState,
  type ReactNode,
} from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { ConfirmDialog } from "../../apps/desktop/src/components/ConfirmDialog.tsx";
import { overlayStack } from "../../apps/desktop/src/state/overlay-stack.ts";

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

function labelOf(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pressKey(key: string, shiftKey = false): void {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(event);
}

async function flushFocus(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function FocusHarness({
  tone = "default",
  withField = false,
  withCheckbox = false,
}: {
  tone?: "default" | "destructive";
  withField?: boolean;
  withCheckbox?: boolean;
}) {
  const [open, setOpen] = useState(false);
  let extra: ReactNode = null;
  if (withField) {
    extra = createElement("input", { "aria-label": "Profile name" });
  } else if (withCheckbox) {
    extra = createElement("input", { type: "checkbox", "aria-label": "Also delete" });
  }
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", id: "dialog-opener", onClick: () => setOpen(true) },
      "Remove profile",
    ),
    createElement("button", { type: "button", id: "behind" }, "Inactive"),
    createElement(ConfirmDialog, {
      open,
      tone,
      title: tone === "destructive" ? "Overwrite files?" : "Remove this profile?",
      description: "Harness files already on disk stay until you apply another profile.",
      confirmLabel: tone === "destructive" ? "Apply anyway" : "Remove profile",
      onConfirm: () => setOpen(false),
      onCancel: () => setOpen(false),
      children: extra,
    }),
  );
}

describe("ConfirmDialog focus trap", () => {
  let root: Root | null = null;
  let dom: Window | null = null;
  const swallows: Array<(event: KeyboardEvent) => void> = [];

  beforeEach(() => {
    dom = installDom();
    Element.prototype.getClientRects = function getClientRects(): DOMRectList {
      return {
        length: 1,
        item: () => null,
        0: { width: 10, height: 10 },
      } as unknown as DOMRectList;
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    for (const swallow of swallows) {
      window.removeEventListener("keydown", swallow);
    }
    swallows.length = 0;
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    document.body.replaceChildren();
    if (dom) {
      uninstallDom(dom);
      dom = null;
    }
  });

  async function openDialog(
    props: {
      tone?: "default" | "destructive";
      withField?: boolean;
      withCheckbox?: boolean;
    } = {},
  ): Promise<HTMLButtonElement> {
    await act(async () => {
      root?.render(createElement(FocusHarness, props));
    });
    const opener = document.getElementById("dialog-opener");
    if (!(opener instanceof HTMLButtonElement)) {
      throw new Error("missing opener");
    }
    opener.focus();
    await act(async () => {
      opener.click();
    });
    await flushFocus();
    return opener;
  }

  it("moves focus into the dialog, traps Tab, closes on Escape, and restores the opener", async () => {
    let swallowed = false;
    const swallow = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        swallowed = true;
        event.preventDefault();
      }
    };
    swallows.push(swallow);
    window.addEventListener("keydown", swallow);

    const opener = await openDialog();
    const dialog = document.querySelector("[role=\"dialog\"]");
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(labelOf(document.activeElement)).toBe("Cancel");
    expect(document.activeElement).not.toBe(opener);

    const buttons = [...(dialog?.querySelectorAll("button") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    expect(first).toBeInstanceOf(HTMLButtonElement);
    expect(last).toBeInstanceOf(HTMLButtonElement);
    if (!(last instanceof HTMLButtonElement) || !(first instanceof HTMLElement)) {
      throw new Error("missing dialog buttons");
    }
    last.focus();
    pressKey("Tab");
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(document.getElementById("behind"));

    pressKey("Tab", true);
    expect(document.activeElement).toBe(last);

    await act(async () => {
      pressKey("Escape");
    });
    await flushFocus();
    expect(swallowed).toBe(false);
    expect(overlayStack.isEmpty()).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it("leaves Escape to an open select or menu portal instead of closing the dialog", async () => {
    await openDialog();
    expect(document.querySelector("[role=\"dialog\"]")).not.toBeNull();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "listbox");
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    option.tabIndex = -1;
    option.textContent = "work";
    wrapper.appendChild(option);
    document.body.appendChild(wrapper);
    option.focus();
    expect(document.activeElement).toBe(option);
    await act(async () => {
      pressKey("Escape");
    });
    expect(overlayStack.isEmpty()).toBe(false);
    wrapper.remove();
    const cancel = [...document.querySelectorAll("[role=\"dialog\"] button")].find(
      (button) => labelOf(button) === "Cancel",
    );
    (cancel as HTMLButtonElement | undefined)?.focus();
    await act(async () => {
      pressKey("Escape");
    });
    await flushFocus();
    expect(overlayStack.isEmpty()).toBe(true);
  });

  it("focuses a text field before the first button", async () => {
    await openDialog({ withField: true });
    expect(document.activeElement).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Profile name");
  });

  it("focuses Cancel on a destructive confirm even when a checkbox is first", async () => {
    await openDialog({ tone: "destructive", withCheckbox: true });
    expect(labelOf(document.activeElement)).toBe("Cancel");
    expect(document.activeElement).not.toBeInstanceOf(HTMLInputElement);
  });

  it("focuses the checkbox on a default-tone confirm", async () => {
    await openDialog({ withCheckbox: true });
    expect(document.activeElement).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Also delete");
  });
});

describe("Remove profile dialog", () => {
  it("is a destructive confirm so Cancel is focused ahead of the checkbox", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../../apps/desktop/src/components/parity/ProfileDeleteControls.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('tone="destructive"');
    expect(source).toContain("Also delete the plugin from the library");
  });
});
