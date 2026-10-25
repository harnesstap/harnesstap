import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessSidebar } from "../../apps/desktop/src/components/harnesses/HarnessSidebar.tsx";
import type { HarnessEntry } from "../../apps/desktop/src/lib/harness-inventory.ts";
import {
  HARNESSES_EMPTY_BODY,
  HARNESSES_EMPTY_TITLE,
} from "../../apps/desktop/src/lib/ui-copy.ts";

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

const workspaceSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/harnesses/HarnessesWorkspace.tsx"),
  "utf8",
);

const CLAUDE: HarnessEntry = {
  id: "claude" as HarnessEntry["id"],
  name: "Claude Code",
  supported: true,
  supports: ["skills"],
  disk: "detected",
  locations: [],
};

function sidebarProps(rows: readonly HarnessEntry[]) {
  return {
    rows,
    selection: { registered: rows.map((row) => row.id) },
    selectedId: rows[0]?.id ?? null,
    editing: false,
    loading: false,
    disabled: false,
    busy: { kind: "idle" } as const,
    onSelect: () => {},
    onRemove: () => {},
  };
}

describe("Harness page actions and empty state", () => {
  it("keeps the sidebar a plain list: no toolbar, no Sync footer, no empty hint", async () => {
    await render(createElement(HarnessSidebar, sidebarProps([])));
    expect(host.textContent ?? "").not.toContain("None set up yet");
    expect(host.querySelectorAll("button").length).toBe(0);

    await render(createElement(HarnessSidebar, sidebarProps([CLAUDE])));
    expect(host.textContent ?? "").toContain("Claude Code");
    expect(host.querySelector('[data-testid="sync-harnesses"]')).toBeNull();
    expect(host.querySelector('[data-testid="add-harness"]')).toBeNull();
    expect(host.querySelector('[data-testid="harnesses-refresh"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="harness-row"]').length).toBe(1);
  });

  it("puts every page action in the header with a tooltip label", () => {
    const header = workspaceSource.slice(
      workspaceSource.indexOf('className="resources-panel-header-actions"'),
      workspaceSource.indexOf("</main>"),
    );
    for (const testId of [
      'testId="harnesses-refresh"',
      'data-testid="edit-harnesses"',
      'data-testid="detect-harnesses"',
      'data-testid="sync-harnesses"',
      'data-testid="add-harness"',
    ]) {
      expect(header).toContain(testId);
    }
    expect(header).toContain('label="Add harness"');
    expect(header).toContain('label={view.editing ? "Done" : "Edit harnesses"}');
  });

  it("offers Detect plus an Add harness link when nothing is set up", () => {
    expect(HARNESSES_EMPTY_TITLE).toBe("No harnesses yet");
    expect(HARNESSES_EMPTY_BODY).toBe("Detect the agents on this machine, or add one by hand.");
    expect(workspaceSource).toContain('data-testid="harnesses-empty-add"');
    expect(workspaceSource).toMatch(/className="link-btn"[\s\S]*?onClick=\{openAdd\}[\s\S]*?Add harness/);
  });

  it("keeps one refresh: error banners carry no Retry", () => {
    const banner = workspaceSource.slice(
      workspaceSource.indexOf("<Banner"),
      workspaceSource.indexOf('testId="harnesses-error"'),
    );
    expect(banner).not.toContain("onRetry");
  });
});
