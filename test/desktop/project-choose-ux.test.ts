import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Window } from "happy-dom";
import { Tooltip } from "../../apps/desktop/node_modules/radix-ui/dist/index.mjs";
import { act, createElement } from "../../apps/desktop/node_modules/react/index.js";
import { createRoot, type Root } from "../../apps/desktop/node_modules/react-dom/client.js";
import { SourcePicker } from "../../apps/desktop/src/components/ui/source-picker.tsx";
import { ChooseProjectButton } from "../../apps/desktop/src/components/ChooseProjectButton.tsx";
import {
  SETTINGS_NO_PROJECT_TITLE,
  SettingsParitySections,
} from "../../apps/desktop/src/components/settings/SettingsParitySections.tsx";
import {
  TELEMETRY_ENV_OFF_LABEL,
  TelemetrySettingsSection,
} from "../../apps/desktop/src/components/settings/TelemetrySettingsSection.tsx";
import * as agentClient from "../../apps/desktop/src/lib/agent-client.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

afterEach(() => {
  act(() => root.unmount());
  uninstallDom(win);
});

function render(node: unknown): void {
  act(() => {
    root.render(createElement(Tooltip.Provider, null, node as never));
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

const src = (rel: string): string =>
  readFileSync(join(import.meta.dir, "../../apps/desktop/src", rel), "utf8");

describe("From project has an inline Choose project step", () => {
  it("a disabled source card shows Choose project, which calls back without selecting the card", () => {
    let chosen = 0;
    let selected = "blank";
    render(
      createElement(SourcePicker, {
        legend: "Source",
        value: "blank",
        onValueChange: (next: string) => {
          selected = next;
        },
        options: [
          { value: "blank", title: "Blank", description: "Empty environment." },
          {
            value: "from-project",
            title: "From project",
            description: "Capture from the selected project directory.",
            disabled: true,
            action: createElement(ChooseProjectButton, {
              onClick: () => {
                chosen += 1;
              },
            }),
          },
        ],
      }),
    );
    const button = buttonByText("Choose project");
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(chosen).toBe(1);
    expect(selected).toBe("blank");
  });

  it("create profile, create environment and import drop the dead-end hints for the inline button", () => {
    for (const rel of [
      "components/CreateProfileDrawer.tsx",
      "components/environments/EnvironmentDrawer.tsx",
      "components/parity/ImportLibraryDrawer.tsx",
    ]) {
      const source = src(rel);
      expect(source).toContain("<ChooseProjectButton");
      expect(source).toMatch(/^\s+onChooseProject,$/m);
      expect(source).not.toContain("Choose a project in the top bar");
      expect(source).not.toContain(">\n                  Choose a project directory");
    }
    const app = src("App.tsx");
    expect(app).toContain("onChooseProject={onChooseProject}");
    expect(src("components/shell/AppOverlays.tsx")).toContain("onChooseProject={onBrowseProject}");
  });
});

describe("Settings > Project without an open project", () => {
  it("shows one empty state with Choose project instead of an empty picker", () => {
    let browsed = 0;
    render(
      createElement(SettingsParitySections, {
        tab: "project",
        open: true,
        baseUrl: null,
        token: null,
        inspectProjectPath: null,
        onSelectProject: () => {},
        onBrowseProject: () => {
          browsed += 1;
        },
      }),
    );
    const empty = document.querySelector('[data-testid="settings-project-empty"]');
    expect(empty?.textContent).toContain(SETTINGS_NO_PROJECT_TITLE);
    expect(document.querySelector('[data-testid="project-config-inspect"]')).toBeNull();
    expect(document.querySelector('[data-testid="project-harness-override"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Select a project");
    const choose = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Choose project"
        || button.textContent?.trim() === "Choose project",
    );
    expect(choose).toBeDefined();
    act(() => (choose as HTMLButtonElement).click());
    expect(browsed).toBe(1);
  });
});

describe("Settings > Advanced telemetry env override", () => {
  it("locks the switch to the env state and says why, instead of a hint below it", async () => {
    const spy = spyOn(agentClient, "fetchTelemetryConsent").mockResolvedValue({
      enabled: false,
      consented: true,
      preference: true,
      env_override: false,
      needs_consent: false,
      copy: { body: "Body.", tracked: ["One"], not_tracked: ["Two"] },
    } as never);
    try {
      render(
        createElement(TelemetrySettingsSection, { open: true, baseUrl: "http://x", token: "t" }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      const toggle = document.querySelector('[data-testid="settings-telemetry-enabled"]');
      expect(toggle?.getAttribute("aria-checked")).toBe("false");
      expect(toggle?.hasAttribute("disabled")).toBe(true);
      expect(document.body.textContent).toContain(TELEMETRY_ENV_OFF_LABEL);
      expect(document.body.textContent).not.toContain("currently disables");
    } finally {
      spy.mockRestore();
    }
  });
});
