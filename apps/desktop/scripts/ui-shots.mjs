#!/usr/bin/env node
// Screenshot walk of the desktop UI in a plain Chromium, with the Tauri IPC
// shimmed (scripts/tauri-shim.js). Starts nothing itself: expects a running
// ht-agent (scripts/demo-home.sh) and a running Vite dev server.
//
// Env:
//   SHOTS_BASE_URL       Vite URL                (http://127.0.0.1:5173/)
//   SHOTS_AGENT_PORT     ht-agent port           (7474)
//   SHOTS_TOKEN_PATH     agent token file        (/tmp/htdemo/home/.harnesstap/agent-token)
//   SHOTS_PROJECT_PATH   folder-picker answer    (/tmp/htdemo/project)
//   SHOTS_OUT            PNG directory           (apps/desktop/e2e/artifacts/shots)
//   SHOTS_CHROME_CHANNEL launch via channel, e.g. "chrome" (system Chrome, no download)
//   SHOTS_CHROME_PATH    launch via executablePath, e.g. /usr/bin/google-chrome-stable
// Flags:
//   --viewports 1440x900,960x640
//   --reduced-motion
//   --compare
//   --update-baselines
//   --axe
//   --trace
//   --suite              four desktop-check walks in one Chromium
import { AsyncLocalStorage } from "node:async_hooks";
import { copyFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { baselinePathFor, compareShot, DEFAULT_MAX_RATIO } from "./visual-compare.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = path.join(SCRIPT_DIR, "tauri-shim.js");
const DEFAULT_OUT = path.resolve(SCRIPT_DIR, "..", "e2e", "artifacts", "shots");
const DEFAULT_BASELINES = path.resolve(SCRIPT_DIR, "..", "e2e", "visual");
const T = 4000;
const SETTLE_MS = 600;
const FRAME_BUDGET_MS = 32;

function parseArgs(argv) {
  const options = {
    viewports: [
      { width: 1440, height: 900 },
      { width: 960, height: 640 },
    ],
    reducedMotion: false,
    compare: false,
    updateBaselines: false,
    axe: false,
    trace: false,
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reduced-motion") {
      options.reducedMotion = true;
    } else if (arg === "--compare") {
      options.compare = true;
    } else if (arg === "--update-baselines") {
      options.updateBaselines = true;
    } else if (arg === "--axe") {
      options.axe = true;
    } else if (arg === "--trace") {
      options.trace = true;
    } else if (arg === "--viewports") {
      options.viewports = parseViewports(argv[++i]);
    } else if (arg.startsWith("--viewports=")) {
      options.viewports = parseViewports(arg.slice("--viewports=".length));
    } else if (arg === "--only") {
      options.only = parseOnly(argv[++i]);
    } else if (arg.startsWith("--only=")) {
      options.only = parseOnly(arg.slice("--only=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseOnly(raw) {
  if (!raw) {
    throw new Error("--only needs a comma-separated list of screen names");
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseViewports(raw) {
  if (!raw) {
    throw new Error("--viewports needs a value like 1440x900,960x640");
  }
  return raw.split(",").map((entry) => {
    const match = /^(\d+)x(\d+)$/.exec(entry.trim());
    if (!match) {
      throw new Error(`Bad viewport "${entry}"; expected <w>x<h>`);
    }
    return { width: Number(match[1]), height: Number(match[2]) };
  });
}

async function readToken(tokenPath) {
  try {
    const raw = await readFile(tokenPath, "utf8");
    return raw.trim() || null;
  } catch {
    console.warn(`shots: token file not readable at ${tokenPath}; mutating routes will 401`);
    return null;
  }
}

function launchOptions() {
  // Pin Chromium to Playwright's browser (same build as mcr.microsoft.com/playwright).
  // Do not fall back to system Chrome: font rasterization drifts across hosts.
  const options = {
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--disable-lcd-text",
    ],
  };
  if (process.env.SHOTS_CHROME_CHANNEL) {
    options.channel = process.env.SHOTS_CHROME_CHANNEL;
  } else if (process.env.SHOTS_CHROME_PATH) {
    options.executablePath = process.env.SHOTS_CHROME_PATH;
  } else {
    options.executablePath = chromium.executablePath();
  }
  return options;
}

const main = (page) => page.locator("main").first();

const walkLogs = new AsyncLocalStorage();
const baseLog = console.log.bind(console);
const baseWarn = console.warn.bind(console);

function emit(line) {
  const buf = walkLogs.getStore();
  if (buf) buf.push(line);
  else baseLog(line);
}

// Installed only for --suite, so concurrent walks keep their own logs.
function installWalkLog() {
  console.log = (...args) => {
    emit(args.map((item) => String(item)).join(" "));
  };
  console.warn = (...args) => {
    const line = args.map((item) => String(item)).join(" ");
    const buf = walkLogs.getStore();
    if (buf) buf.push(line);
    else baseWarn(line);
  };
}

function restoreWalkLog() {
  console.log = baseLog;
  console.warn = baseWarn;
}

async function settle(page) {
  await main(page).waitFor({ state: "visible", timeout: T });
  await page.waitForTimeout(SETTLE_MS);
}

async function pressEscape(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

async function dismissResourceTypeModal(page) {
  const close = page.getByTestId("resource-type-close");
  if (await close.isVisible().catch(() => false)) {
    await close.click({ timeout: T });
    await page
      .getByTestId("resource-type-modal")
      .waitFor({ state: "hidden", timeout: T })
      .catch(() => {});
  }
  await pressEscape(page);
}

async function clickHeader(page, name) {
  const typeClose = page.getByTestId("resource-type-close");
  if (await typeClose.isVisible().catch(() => false)) {
    await typeClose.click({ timeout: T });
    await page
      .getByTestId("resource-type-modal")
      .waitFor({ state: "hidden", timeout: T })
      .catch(() => {});
  }
  await page.getByRole("button", { name }).first().click({ timeout: T });
}

/** Profile tab, then the Global side of its scope switch. */
async function openGlobalProfile(page) {
  await clickHeader(page, /^profile$/i);
  await page.getByTestId("profile-scope-global").click({ timeout: T });
}

/** Profile tab on Project. With no project set yet, Project opens the project dropdown; Browse uses the shim folder picker. */
async function openProjectProfile(page) {
  await clickHeader(page, /^profile$/i);
  await page.getByTestId("profile-scope-project").click({ timeout: T });
  const browse = page.locator(".project-picker-footer button").first();
  if (await browse.isVisible({ timeout: 1500 }).catch(() => false)) {
    await browse.click({ timeout: T });
  }
  await page
    .locator('[data-testid="profile-scope-project"][aria-pressed="true"]')
    .waitFor({ timeout: T });
}

/**
 * The Profile scope switch has fixed segment widths: its box must not move or
 * resize between Global, Project, a long project name, no project and the open
 * dropdown, and the chevron must stay inside it. The first measurement on a
 * page is the reference for the rest of that walk.
 */
const switchReference = new WeakMap();

async function switchGeometry(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="profile-scope-switch"]');
    const chevron = root?.querySelector('[data-testid="project-path"]');
    const label = root?.querySelector('[data-testid="profile-scope-project-label"]');
    if (!root || !chevron || !label) return null;
    const r = root.getBoundingClientRect();
    const c = chevron.getBoundingClientRect();
    const round = (n) => Math.round(n * 2) / 2;
    return {
      box: [r.x, r.y, r.width, r.height].map(round).join(","),
      width: round(r.width),
      chevronInside: c.width > 0 && c.left >= r.left && c.right <= r.right + 0.5,
      truncated: label.scrollWidth > label.clientWidth + 0.5,
      ellipsis: getComputedStyle(label).textOverflow === "ellipsis",
    };
  });
}

async function assertSwitchStable(page, state) {
  const geo = await switchGeometry(page);
  if (!geo) throw new Error(`profile scope switch missing (${state})`);
  if (!geo.chevronInside) throw new Error(`project chevron not visible inside the switch (${state})`);
  const reference = switchReference.get(page);
  if (!reference) {
    switchReference.set(page, geo.box);
  } else if (reference !== geo.box) {
    throw new Error(`profile scope switch moved or resized on ${state}: ${reference} -> ${geo.box}`);
  }
  console.log(`shots: profile switch ${state}: ${geo.box}`);
  return geo;
}

/** Long project name: render it in the real label, check truncation and size, then restore. */
async function assertSwitchLongName(page) {
  const original = await page.getByTestId("profile-scope-project-label").evaluate((label) => {
    const text = label.textContent;
    label.textContent = `Project: ${"a-really-long-project-folder-name-".repeat(3)}end`;
    return text;
  });
  try {
    const geo = await assertSwitchStable(page, "long project name");
    if (!geo.truncated || !geo.ellipsis) throw new Error("long project name is not cut with an ellipsis");
  } finally {
    await page.getByTestId("profile-scope-project-label").evaluate((label, text) => {
      label.textContent = text;
    }, original);
  }
}

/** Global, Project, dropdown open and a long name all keep the switch box. */
async function assertSwitchStableAcrossStates(page) {
  await assertSwitchStable(page, "project");
  await page.getByTestId("profile-scope-global").click({ timeout: T });
  await page.locator('[data-testid="profile-scope-global"][aria-pressed="true"]').waitFor({ timeout: T });
  await assertSwitchStable(page, "global with a project");
  await page.getByTestId("project-path").click({ timeout: T });
  await page.locator('[data-testid="project-path"][aria-expanded="true"]').waitFor({ timeout: T });
  await assertSwitchStable(page, "dropdown open");
  await pressEscape(page);
  await page.locator('[data-testid="project-path"][aria-expanded="false"]').waitFor({ timeout: T });
  await page.getByTestId("profile-scope-project").click({ timeout: T });
  await page.locator('[data-testid="profile-scope-project"][aria-pressed="true"]').waitFor({ timeout: T });
  await assertSwitchStable(page, "project again");
  await assertSwitchLongName(page);
}

async function dismissTrackedDirectories(page) {
  const dialog = page.getByRole("dialog", { name: /tracked directories/i });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /^done$/i }).click({ timeout: T });
    await page.waitForTimeout(150);
  }
}

async function openSettingsTab(page, label) {
  const tab = page.getByRole("tab", { name: label });
  if (await tab.count()) {
    await tab.first().click({ timeout: T });
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).first().click({ timeout: T });
}

/** Clicking a tab can scroll the drawer a few pixels depending on timing; pin it to the top. */
async function resetSettingsScroll(page) {
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const drawer = document.querySelector("[data-testid='settings-drawer']");
    if (!drawer) return;
    for (const node of [drawer, ...drawer.querySelectorAll("*")]) {
      if (node.scrollTop) node.scrollTop = 0;
    }
  });
}

async function openSettings(page) {
  if (!(await page.getByRole("tablist", { name: /settings/i }).isVisible().catch(() => false))) {
    await clickHeader(page, /^settings$/i);
  }
}

async function openLibrary(page) {
  await clickHeader(page, /^library$/i);
  await dismissTrackedDirectories(page);
}

async function clickFirstLibraryRow(page) {
  const row = main(page).locator("[data-testid^='resource-row-']").first();
  await row.waitFor({ state: "visible", timeout: T });
  await row.click({ timeout: T });
}

async function clickFirstDiscoverRow(page) {
  const hit = main(page).locator("[data-testid^='sources-hit-']").first();
  await hit.waitFor({ state: "visible", timeout: T });
  await hit.click({ timeout: T });
}

async function openMoreItem(page, name) {
  await pressEscape(page);
  await page.getByTestId("header-more").click({ timeout: 10_000 });
  await page.getByRole("menuitem", { name }).first().click({ timeout: 10_000 });
}

/**
 * Each step drives the page to a screen; the harness screenshots after it
 * returns. `after` runs post-screenshot (e.g. Escape to close an overlay).
 */
async function waitForResourceRows(page) {
  await main(page)
    .locator("[data-testid^='resource-row-']")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Regression guard for the Profiles rail: at rest, a profile name gets the
 * row's whole width between the paddings, less only marks that are actually
 * shown. An empty reserved slot (badge, hover action) fails the walk.
 */
async function assertRailNamesUseFullWidth(page) {
  await page.mouse.move(0, 0);
  await page.locator(".profile-item-name").first().waitFor({ state: "visible", timeout: 15_000 });
  const problems = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll(".profile-item")) {
      const main = row.querySelector(".profile-item-main");
      const name = row.querySelector(".profile-item-name");
      if (!main || !name) {
        out.push("row without a name");
        continue;
      }
      const label = name.textContent ?? "";
      const rowRect = row.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const rowStyle = getComputedStyle(row);
      const borders = parseFloat(rowStyle.borderLeftWidth) + parseFloat(rowStyle.borderRightWidth);
      if (mainRect.width < rowRect.width - borders - 1) {
        out.push(`${label}: ${Math.round(rowRect.width - borders - mainRect.width)}px reserved beside the row button`);
      }
      const style = getComputedStyle(main);
      const gap = parseFloat(style.columnGap) || 0;
      let free = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      for (const child of main.children) {
        if (child === name) continue;
        const width = child.getBoundingClientRect().width;
        if (width === 0) continue;
        if (child.children.length === 0 && !(child.textContent ?? "").trim()) {
          out.push(`${label}: empty ${child.className || child.tagName} reserves ${Math.round(width)}px`);
        }
        free -= width + gap;
      }
      const nameWidth = name.getBoundingClientRect().width;
      if (nameWidth < free - 1) {
        out.push(`${label}: name gets ${Math.round(nameWidth)}px of ${Math.round(free)}px`);
      }
    }
    return out;
  });
  if (problems.length > 0) {
    throw new Error(`Profiles rail names lose width: ${problems.join("; ")}`);
  }
}

const SCREENS = [
  {
    name: "scope-global",
    run: async (page) => {
      await openGlobalProfile(page);
      await assertSwitchStable(page, "global, no project");
      await assertRailNamesUseFullWidth(page);
    },
  },
  {
    name: "scope-project",
    run: async (page) => {
      await openProjectProfile(page);
      await assertSwitchStableAcrossStates(page);
      await waitForResourceRows(page);
    },
  },
  {
    name: "library-list",
    run: async (page) => {
      await openLibrary(page);
      await waitForResourceRows(page);
    },
  },
  {
    name: "library-detail",
    run: async (page) => {
      await clickFirstLibraryRow(page);
    },
  },
  {
    name: "library-create-picker",
    run: async (page) => {
      await openLibrary(page);
      await page.getByTestId("library-list-fab").click({ timeout: T });
    },
    after: dismissResourceTypeModal,
  },
  {
    name: "discover-list",
    run: async (page) => {
      await clickHeader(page, /^discover$/i);
      await page.getByTestId("sources-workspace").waitFor({ timeout: T });
      await page
        .locator("[data-testid^='sources-hit-']")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(SETTLE_MS);
    },
  },
  {
    name: "discover-tree",
    run: async (page) => {
      await clickFirstDiscoverRow(page);
    },
  },
  {
    name: "environments",
    run: async (page) => {
      await clickHeader(page, /^environments$/i);
    },
  },
  {
    name: "harnesses",
    run: async (page) => {
      await clickHeader(page, /^harnesses$/i);
    },
  },
  {
    name: "settings-project",
    run: async (page) => {
      await openSettings(page);
      await openSettingsTab(page, "Project");
      await resetSettingsScroll(page);
    },
  },
  {
    name: "settings-advanced",
    run: async (page) => {
      await openSettings(page);
      await openSettingsTab(page, "Advanced");
      await resetSettingsScroll(page);
    },
    after: pressEscape,
  },
  {
    name: "export",
    run: async (page) => {
      await openMoreItem(page, /^export setup$/i);
    },
    after: pressEscape,
  },
  {
    name: "import",
    run: async (page) => {
      await openMoreItem(page, /^import setup$/i);
    },
    after: pressEscape,
  },
  {
    name: "account",
    run: async (page) => {
      await openMoreItem(page, /^account/i);
    },
    after: pressEscape,
  },
  {
    name: "harness-scope-all-rest",
    run: async (page, baseUrl) => {
      await openHarnessScopeGallery(page, baseUrl, "all-rest");
    },
  },
  {
    name: "harness-scope-all-hover",
    run: async (page, baseUrl) => {
      await openHarnessScopeGallery(page, baseUrl, "all-hover");
    },
  },
  {
    name: "harness-scope-subset",
    run: async (page, baseUrl) => {
      await openHarnessScopeGallery(page, baseUrl, "subset");
    },
  },
  {
    name: "harness-scope-orphaned",
    run: async (page, baseUrl) => {
      await openHarnessScopeGallery(page, baseUrl, "orphaned");
    },
  },
  {
    name: "harness-scope-popover",
    run: async (page, baseUrl) => {
      await openHarnessScopeGallery(page, baseUrl, "popover");
      await page.getByTestId("harness-scope-popover").waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "risky-removal-dialog",
    run: async (page, baseUrl) => {
      const url = new URL(baseUrl);
      url.searchParams.set("visual", "risky-removal");
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("dialog").waitFor({ timeout: 15_000 });
      await page.getByTestId("risky-removal-dialog").waitFor({ state: "attached", timeout: 15_000 });
    },
  },
  {
    name: "file-change-groups",
    run: async (page, baseUrl) => {
      const url = new URL(baseUrl);
      url.searchParams.set("visual", "file-change-groups");
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByTestId("file-change-groups-gallery").waitFor({ timeout: 15_000 });
      await page.getByText("Kept. You changed it.", { exact: true }).waitFor({ timeout: 15_000 });
      await page.getByText("Kept. Not made by HarnessTap.", { exact: true }).waitFor({ timeout: 15_000 });
      await page.getByText("Will remove", { exact: true }).waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "action-toast",
    run: async (page, baseUrl) => {
      const url = new URL(baseUrl);
      url.searchParams.set("visual", "action-toast");
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByTestId("action-toast-gallery").waitFor({ timeout: 15_000 });
      await page.getByTestId("toast").waitFor({ timeout: 15_000 });
    },
  },
  {
    // Global scope rows carry no in-use mark; each row and its divider must
    // still span the full list width.
    name: "library-global-plugin-refs",
    run: async (page, baseUrl) => {
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForConnected(page);
      await openGlobalProfile(page);
      await openLibrary(page);
      await waitForResourceRows(page);
      await main(page).locator(".resource-type-tab").filter({ hasText: /plugin refs?$/ }).first().click({ timeout: T });
      await waitForResourceRows(page);
      await page.mouse.move(0, 0);
    },
  },
  {
    // Regression: hovering or focusing a resource badge reveals its actions in
    // an overlay. No other badge may move, and the last badge of a row must not
    // overflow the row. Fails the walk if either happens.
    name: "inventory-chip-hover",
    run: async (page, baseUrl) => {
      // The demo home has no badges with actions, so use the badge gallery row.
      await openHarnessScopeGallery(page, baseUrl, "chip-row");
      await page.getByTestId("chip-row-gallery").waitFor({ timeout: 15_000 });
      await page.mouse.move(0, 0);
      await settle(page);
      const target = await markLastChipOfRow(page);
      if (!target) throw new Error("no resource badge with actions to hover");
      const before = await chipRects(page);
      const last = page.locator("[data-qa-chip-target]");
      await last.locator(".inventory-chip-name").hover({ timeout: T });
      await page.waitForTimeout(300);
      await assertNoReflow(page, before, "hover");
      await page.mouse.move(0, 0);
      await last.locator(".inventory-chip-name").focus();
      await page.keyboard.press("Tab");
      await page.waitForTimeout(300);
      await assertNoReflow(page, before, "keyboard focus");
      await last.locator(".inventory-chip-name").hover({ timeout: T });
      await page.waitForTimeout(300);
    },
    after: async (page) => {
      await page.mouse.move(0, 0);
      await page.keyboard.press("Escape");
    },
  },
  {
    // One Also use on line per type section, with Add all and Dismiss.
    name: "harness-scope-suggestion",
    run: async (page, baseUrl) => {
      await openHarnessScopeGallery(page, baseUrl, "suggestion");
      await page.getByTestId("section-suggestion").waitFor({ timeout: 15_000 });
      await page.mouse.move(0, 0);
    },
  },
];

/** Marks the last badge (with actions) of the first full row, else of the biggest row. */
async function markLastChipOfRow(page) {
  return page.evaluate(() => {
    const clusters = [...document.querySelectorAll("main .inventory-chip-cluster")];
    clusters.sort((a, b) => b.querySelectorAll(".inventory-chip").length - a.querySelectorAll(".inventory-chip").length);
    const pick = (cluster, chip) => {
      cluster.setAttribute("data-qa-chip-cluster", "");
      chip.setAttribute("data-qa-chip-target", "");
      return chip.getAttribute("data-testid");
    };
    for (const cluster of clusters) {
      const chips = [...cluster.querySelectorAll(".inventory-chip")];
      for (let i = 0; i < chips.length - 1; i++) {
        const wraps = chips[i + 1].getBoundingClientRect().top > chips[i].getBoundingClientRect().top + 4;
        if (wraps && chips[i].querySelector(".inventory-chip-extension")) return pick(cluster, chips[i]);
      }
    }
    for (const cluster of clusters) {
      const chips = [...cluster.querySelectorAll(".inventory-chip")].filter((chip) => chip.querySelector(".inventory-chip-extension"));
      if (chips.length) return pick(cluster, chips[chips.length - 1]);
    }
    return null;
  });
}

async function chipRects(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main .inventory-chip")].map((chip) => {
      const r = chip.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(",");
    }),
  );
}

async function assertNoReflow(page, before, how) {
  const after = await chipRects(page);
  const moved = after.filter((rect, index) => rect !== before[index]).length;
  if (after.length !== before.length || moved > 0) {
    throw new Error(`badge row reflowed on ${how}: ${moved} badge(s) moved`);
  }
  const overflow = await page.evaluate(() => {
    const cluster = document.querySelector("[data-qa-chip-cluster]");
    const ext = document.querySelector("[data-qa-chip-target] .inventory-chip-extension");
    if (!cluster || !ext) return "missing";
    if (getComputedStyle(ext).opacity === "0") return "extension hidden";
    const rowRight = cluster.getBoundingClientRect().right;
    const extRight = ext.getBoundingClientRect().right;
    return extRight > rowRight + 0.5 ? `extension ends at ${Math.round(extRight)}, row at ${Math.round(rowRight)}` : "";
  });
  if (overflow) throw new Error(`badge extension on ${how}: ${overflow}`);
}

/**
 * Nightly visual starts at SHOTS_BASE_URL with no query. Gallery states are a
 * dedicated `?visual=` mount, so leave the SPA via about:blank and reload from
 * that base URL — `page.url()` after Settings/More overlays is not a reliable
 * origin, and a query-only goto may not remount `main.tsx`.
 */
async function openHarnessScopeGallery(page, baseUrl, state) {
  const url = new URL(baseUrl);
  url.searchParams.set("visual", "harness-scope");
  url.searchParams.set("state", state);
  await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByTestId("harness-scope-gallery").waitFor({ timeout: 15_000 });
}

async function waitForConnected(page) {
  // ConnectSplash has no <main> until the first health check succeeds, and the
  // first Vite compile of App.tsx can exceed the per-screen settle timeout.
  await main(page).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(SETTLE_MS);
  const banner = page.getByText(/waiting for sidecar health check/i);
  await banner.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {
    console.warn("shots: sidecar banner still visible after 15s; continuing");
  });
}

async function countAnimations(page) {
  return page.evaluate(() => document.getAnimations().length);
}

async function runAxe(page, tag, screenName, report) {
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();
  const blocking = results.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  for (const item of blocking) {
    const nodes = item.nodes.map((node) => node.target.join(" ")).join("; ");
    report.axeFailures.push(`[${tag}] ${screenName}: ${item.id} (${item.impact}) ${nodes}`);
  }
}

async function longestFrameMs(page, action) {
  await page.evaluate(() => {
    window.__htFrames = [];
    window.__htLast = 0;
    const tick = (now) => {
      if (window.__htLast) {
        window.__htFrames.push(now - window.__htLast);
      }
      window.__htLast = now;
      window.__htRafId = requestAnimationFrame(tick);
    };
    window.__htRafId = requestAnimationFrame(tick);
  });
  await action();
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    cancelAnimationFrame(window.__htRafId);
    const frames = window.__htFrames ?? [];
    return frames.reduce((max, ms) => (ms > max ? ms : max), 0);
  });
}

async function runMotionTrace(page, tag, report) {
  const overlayMs = await longestFrameMs(page, async () => {
    await page.keyboard.press("Control+k").catch(() => {});
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape").catch(() => {});
  });
  const scrollMs = await longestFrameMs(page, async () => {
    await page.locator("main").first().evaluate((node) => {
      node.scrollTop = Math.min(node.scrollHeight, 2400);
    }).catch(() => {});
  });
  for (const [label, ms] of [
    ["overlay", overlayMs],
    ["list-scroll", scrollMs],
  ]) {
    if (ms > FRAME_BUDGET_MS) {
      report.traceFailures.push(
        `[${tag}] ${label}: longest frame ${ms.toFixed(1)}ms > ${FRAME_BUDGET_MS}ms`,
      );
    } else {
      console.log(`ok   trace ${label} (${tag}) ${ms.toFixed(1)}ms`);
    }
  }
}

async function walkViewport(browser, viewport, config, report) {
  const { width, height } = viewport;
  const tag = `${width}x${height}`;
  const context = await browser.newContext({
    viewport,
    reducedMotion: config.reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript(
    ({ token, port, projectPath }) => {
      window.__HT_TOKEN__ = token;
      window.__HT_AGENT_PORT__ = port;
      window.__HT_PROJECT_PATH__ = projectPath;
    },
    { token: config.token, port: config.agentPort, projectPath: config.projectPath },
  );
  await context.addInitScript({ path: SHIM_PATH });

  const page = await context.newPage();
  page.on("pageerror", (error) => {
    report.pageErrors.push(`[${tag}] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const url = message.location()?.url;
      report.consoleErrors.push(
        `[${tag}] ${message.text()}${url ? ` ${url}` : ""}`,
      );
    }
  });

  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForConnected(page);

  for (let index = 0; index < SCREENS.length; index++) {
    const screen = SCREENS[index];
    if (config.only && !config.only.includes(screen.name)) {
      continue;
    }
    const file = path.join(
      config.outDir,
      `${String(index + 1).padStart(2, "0")}-${screen.name}-${tag}.png`,
    );
    try {
      await screen.run(page, config.baseUrl);
      await settle(page);
      if (config.reducedMotion) {
        const running = await countAnimations(page);
        if (running > 0) {
          report.motionFailures.push(
            `[${tag}] ${screen.name}: ${running} animation(s) still running`,
          );
        }
      }
      if (config.axe) {
        await runAxe(page, tag, screen.name, report);
      }
      await page.screenshot({ path: file, fullPage: false });
      report.written.push(file);
      console.log(`ok   ${path.relative(process.cwd(), file)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      report.stepFailures.push(`[${tag}] ${screen.name}: ${message}`);
      console.log(`STEP FAIL ${screen.name} (${tag}): ${message}`);
    }
    if (screen.after) {
      await screen.after(page).catch(() => {});
    }
  }

  if (config.trace) {
    try {
      await runMotionTrace(page, tag, report);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      report.traceFailures.push(`[${tag}] ${message}`);
    }
  }

  await context.close();
}

function shotOutDir(embedded) {
  if (embedded.outDir) return path.resolve(embedded.outDir);
  if (process.env.SHOTS_OUT) return path.resolve(process.env.SHOTS_OUT);
  return DEFAULT_OUT;
}

async function run(argv, embedded = {}) {
  const args = parseArgs(argv);
  const config = {
    baseUrl: process.env.SHOTS_BASE_URL ?? "http://127.0.0.1:5173/",
    agentPort: Number(process.env.SHOTS_AGENT_PORT ?? 7474),
    tokenPath: process.env.SHOTS_TOKEN_PATH ?? "/tmp/htdemo/home/.harnesstap/agent-token",
    projectPath: process.env.SHOTS_PROJECT_PATH ?? "/tmp/htdemo/project",
    outDir: shotOutDir(embedded),
    baselineDir: process.env.SHOTS_BASELINES
      ? path.resolve(process.env.SHOTS_BASELINES)
      : DEFAULT_BASELINES,
    reducedMotion: args.reducedMotion,
    compare: args.compare,
    updateBaselines: args.updateBaselines,
    only: args.only,
    axe: args.axe,
    trace: args.trace,
    token: null,
  };
  config.token = await readToken(config.tokenPath);
  await mkdir(config.outDir, { recursive: true });
  await mkdir(config.baselineDir, { recursive: true });

  const report = {
    written: [],
    stepFailures: [],
    pageErrors: [],
    consoleErrors: [],
    compareFailures: [],
    axeFailures: [],
    motionFailures: [],
    traceFailures: [],
  };
  const ownBrowser = !embedded.browser;
  const browser = embedded.browser ?? (await chromium.launch(launchOptions()));
  try {
    for (const viewport of args.viewports) {
      await walkViewport(browser, viewport, config, report);
    }
  } finally {
    if (ownBrowser) await browser.close();
  }

  if (config.updateBaselines) {
    if (process.env.SHOTS_PINNED_IMAGE !== "1") {
      throw new Error(
        "shots: --update-baselines only runs inside the pinned Playwright image (SHOTS_PINNED_IMAGE=1). Use apps/desktop/scripts/update-visual-baselines.sh or the desktop-visual CI job.",
      );
    }
    for (const file of report.written) {
      copyFileSync(file, baselinePathFor(file, config.baselineDir));
    }
    console.log(`shots: updated ${report.written.length} baselines in ${config.baselineDir}`);
  }

  if (config.compare) {
    let worst = { ratio: 0, name: "-" };
    for (const file of report.written) {
      const baseline = baselinePathFor(file, config.baselineDir);
      const diffPath = path.join(config.outDir, `diff-${path.basename(file)}`);
      const result = compareShot(file, baseline, { diffPath });
      if (result.ratio > worst.ratio) {
        worst = { ratio: result.ratio, name: path.basename(file) };
      }
      if (!result.ok) {
        report.compareFailures.push(
          `${path.basename(file)}: ${result.reason ?? "mismatch"}`,
        );
      }
    }
    console.log(
      `shots: compared ${report.written.length}, worst mismatch ${(worst.ratio * 100).toFixed(4)}% (${worst.name}), limit ${(DEFAULT_MAX_RATIO * 100).toFixed(1)}%`,
    );
  }

  console.log("");
  console.log(`shots: ${report.written.length} screenshots in ${config.outDir}`);
  const groups = [
    ["step", report.stepFailures],
    ["compare", report.compareFailures],
    ["axe", report.axeFailures],
    ["reduced-motion", report.motionFailures],
    ["trace", report.traceFailures],
    ["pageerror", report.pageErrors],
  ];
  let failed = false;
  for (const [label, lines] of groups) {
    if (lines.length) {
      failed = true;
      console.log(`shots: ${lines.length} ${label} failure(s)`);
      for (const line of lines) {
        console.log(`  ${line}`);
      }
    }
  }
  if (report.consoleErrors.length) {
    console.log(`shots: ${report.consoleErrors.length} console error(s)`);
    for (const line of report.consoleErrors) {
      console.log(`  ${line}`);
    }
  }
  if (report.pageErrors.length === 0) {
    console.log("shots: 0 pageerrors");
  }
  return failed;
}

async function warmBrowser(browser, baseUrl) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await main(page).waitFor({ state: "visible", timeout: 30_000 });
  } finally {
    await context.close();
  }
}

async function runLoggedWalk(browser, walk) {
  const lines = [];
  const started = Date.now();
  let walkFailed = false;
  try {
    walkFailed = await walkLogs.run(lines, () =>
      run(walk.argv, { browser, outDir: walk.outDir }),
    );
  } catch (error) {
    walkFailed = true;
    lines.push(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  lines.push(`walk ${walk.name}: exit ${walkFailed ? 1 : 0} in ${seconds}s`);
  return { name: walk.name, lines, walkFailed };
}

async function runSuite() {
  const artifacts = path.resolve(SCRIPT_DIR, "..", "e2e", "artifacts");
  const shots = DEFAULT_OUT;
  const walks = [
    {
      name: "compare-1440x900",
      argv: ["--compare", "--axe", "--viewports", "1440x900"],
      outDir: shots,
    },
    {
      name: "compare-960x640",
      argv: ["--compare", "--axe", "--viewports", "960x640"],
      outDir: shots,
    },
    {
      name: "reduced-motion",
      argv: ["--reduced-motion", "--axe", "--viewports", "1440x900"],
      outDir: path.join(artifacts, "shots-reduced-motion"),
    },
    {
      name: "trace",
      argv: ["--trace", "--viewports", "1440x900"],
      outDir: path.join(artifacts, "shots-trace"),
    },
  ];
  const baseUrl = process.env.SHOTS_BASE_URL ?? "http://127.0.0.1:5173/";
  const logsDir = path.join(artifacts, "logs");
  await mkdir(logsDir, { recursive: true });
  installWalkLog();
  let browser;
  let failed = false;
  try {
    browser = await chromium.launch(launchOptions());
    const warmStart = Date.now();
    await warmBrowser(browser, baseUrl);
    baseLog(`shots: warm ${((Date.now() - warmStart) / 1000).toFixed(1)}s`);
    // 1440 compare stays within 0.2% while another page is open. 960 compare
    // does not: a second page shifts the settings title by a stable ~19px.
    // Trace samples rAF and misses the 32ms budget unless it is the only page.
    const batches = [
      ["compare-1440x900", "reduced-motion"],
      ["compare-960x640"],
      ["trace"],
    ];
    const results = [];
    for (const names of batches) {
      const batch = names.map((name) => {
        const walk = walks.find((item) => item.name === name);
        if (!walk) throw new Error(`missing walk ${name}`);
        return walk;
      });
      const batchResults = await Promise.all(batch.map((walk) => runLoggedWalk(browser, walk)));
      results.push(...batchResults);
    }
    for (const result of results) {
      const text = result.lines.join("\n");
      await writeFile(path.join(logsDir, `${result.name}.log`), `${text}\n`);
      if (result.walkFailed) {
        failed = true;
        baseLog(`::error::walk ${result.name} failed`);
        baseLog(text);
      } else {
        baseLog(`::group::${result.name}`);
        baseLog(text);
        baseLog("::endgroup::");
      }
    }
  } finally {
    restoreWalkLog();
    if (browser) await browser.close();
  }
  return failed;
}

async function cliMain() {
  const argv = process.argv.slice(2);
  if (argv.includes("--suite")) {
    if (argv.length !== 1) {
      throw new Error("--suite does not take other flags");
    }
    const failed = await runSuite();
    if (failed) process.exitCode = 1;
    return;
  }
  const failed = await run(argv);
  if (failed) process.exitCode = 1;
}

cliMain().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
