import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { ConfirmDialog } from "../../apps/desktop/src/components/ConfirmDialog.tsx";
import { DisabledReason } from "../../apps/desktop/src/components/DisabledReason.tsx";
import { RiskyRemovalDialog } from "../../apps/desktop/src/components/RiskyRemovalDialog.tsx";
import { detectDialogCopy } from "../../apps/desktop/src/components/harnesses/DetectHarnessesDialog.tsx";
import type { DetectProposal } from "../../apps/desktop/src/lib/harness-inventory.ts";
import { APPLY_RESULT_COPY, REMOVAL_CONFIRM_COPY } from "../../apps/desktop/src/lib/ui-copy.ts";
import { syncHarnessesConfirmBody } from "../../apps/desktop/src/lib/harness-sync.ts";
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

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")) as unknown as HTMLButtonElement[];
}

describe("risky removal dialog", () => {
  it("counts kept files in the title and keeps Apply and keep as the primary", async () => {
    const calls: string[] = [];
    await render(
      createElement(RiskyRemovalDialog, {
        open: true,
        groups: {
          owned_unmodified: ["a.md"],
          owned_modified: ["notes.md"],
          unmanaged: ["extra.json"],
        },
        onKeep: () => calls.push("keep"),
        onRemoveToo: () => calls.push("remove"),
        onCancel: () => calls.push("cancel"),
      }),
    );
    expect(document.querySelector("h2")?.textContent).toBe("2 files will be kept");
    const labels = buttons().map((button) => button.textContent?.trim());
    expect(labels).toEqual(["Cancel", "Remove anyway", "Apply and keep"]);
    const [, removeAnyway, keep] = buttons();
    expect(removeAnyway?.classList.contains("destructive-secondary")).toBe(true);
    expect(keep?.classList.contains("primary")).toBe(true);
    expect(document.querySelectorAll(".risky-removal-group")).toHaveLength(2);
    await act(async () => {
      keep?.click();
    });
    expect(calls).toEqual(["keep"]);
  });

  it("uses singular copy for one kept file", () => {
    expect(REMOVAL_CONFIRM_COPY.title(1)).toBe("1 file will be kept");
  });
});

describe("apply result toast copy", () => {
  it("reads as one sentence and skips zero counts", () => {
    expect(APPLY_RESULT_COPY.wroteRemovedKept(0, 6, 19)).toBe("Applied. Removed 6 files, kept 19.");
    expect(APPLY_RESULT_COPY.wroteRemovedKept(1, 0, 0)).toBe("Applied. Wrote 1 file.");
    expect(APPLY_RESULT_COPY.wroteRemovedKept(0, 0, 0)).toBe("Applied.");
  });

  it("gives the toast room for the sentence on one line", () => {
    expect(readDesktopCss()).toContain("width: min(420px, calc(100vw - 2 * var(--space-4)))");
  });
});

describe("disabled actions explain themselves", () => {
  it("wraps a disabled button in a reason host and leaves an enabled one bare", async () => {
    await render(
      createElement(
        "div",
        null,
        createElement(
          DisabledReason,
          { reason: "Pick at least one resource" },
          createElement("button", { type: "button", className: "btn primary", disabled: true }, "Add"),
        ),
        createElement(
          DisabledReason,
          { reason: null },
          createElement("button", { type: "button", className: "btn primary" }, "Continue"),
        ),
      ),
    );
    const hosts = document.querySelectorAll("[data-disabled-reason]");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.getAttribute("data-disabled-reason")).toBe("Pick at least one resource");
    expect(hosts[0]?.textContent).toBe("Add");
  });

  it("styles disabled primaries and destructives as neutral, not accent or red", () => {
    const css = readDesktopCss();
    const block = css.match(
      /\.btn\.primary:disabled:not\(\.is-busy\),[\s\S]*?\{([^}]*)\}/,
    )?.[1];
    expect(block).toBeDefined();
    expect(block).toContain("background: var(--surface-2)");
    expect(block).toContain("color-mix(in srgb, var(--fg) 40%, transparent)");
    expect(css).toMatch(/\.btn\.destructive:disabled:not\(\.is-busy\)/);
  });

  it("shows the confirm hint as text when a dialog's primary is disabled", async () => {
    await render(
      createElement(ConfirmDialog, {
        open: true,
        title: "Tag profile version",
        confirmLabel: "Tag version",
        confirmDisabled: true,
        confirmHint: "Enter a new version",
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(document.querySelector(".confirm-dialog-hint")?.textContent).toBe("Enter a new version");
    const confirm = buttons().find((button) => button.textContent?.includes("Tag version"));
    expect(confirm?.disabled).toBe(true);
    expect(confirm?.getAttribute("title")).toBe("Enter a new version");
  });
});

describe("harness dialogs", () => {
  const entry = (id: string) => ({ id }) as unknown as DetectProposal["add"][number];

  it("frames detection as adding harnesses, not Apply", () => {
    const proposal: DetectProposal = { add: [entry("claude"), entry("cursor")], remove: [] };
    const copy = detectDialogCopy(proposal, new Set(["claude", "cursor"]) as never);
    expect(copy).toEqual({
      title: "Harnesses found",
      description: "Add these to HarnessTap? Nothing on disk changes.",
      confirmLabel: "Add 2 harnesses",
    });
  });

  it("names removals when the machine lost a harness", () => {
    const proposal: DetectProposal = { add: [], remove: [entry("codex")] };
    const copy = detectDialogCopy(proposal, new Set(["codex"]) as never);
    expect(copy.title).toBe("Harnesses changed");
    expect(copy.confirmLabel).toBe("Remove 1 harness");
    expect(copy.confirmLabel).not.toContain("Apply");
  });

  it("explains sync in plain words", () => {
    expect(syncHarnessesConfirmBody()).toBe(
      "Copy resources between your harnesses so each one has the same set. If two copies differ, the newest one wins.",
    );
  });
});
