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
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = path.join(SCRIPT_DIR, "tauri-shim.js");
const DEFAULT_OUT = path.resolve(SCRIPT_DIR, "..", "e2e", "artifacts", "shots");
const T = 4000;
const SETTLE_MS = 600;

function parseArgs(argv) {
  const options = {
    viewports: [
      { width: 1440, height: 900 },
      { width: 960, height: 640 },
    ],
    reducedMotion: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reduced-motion") {
      options.reducedMotion = true;
    } else if (arg === "--viewports") {
      options.viewports = parseViewports(argv[++i]);
    } else if (arg.startsWith("--viewports=")) {
      options.viewports = parseViewports(arg.slice("--viewports=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
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
  const options = { args: ["--no-sandbox"] };
  if (process.env.SHOTS_CHROME_CHANNEL) {
    options.channel = process.env.SHOTS_CHROME_CHANNEL;
  } else if (process.env.SHOTS_CHROME_PATH) {
    options.executablePath = process.env.SHOTS_CHROME_PATH;
  } else if (existsSync("/usr/bin/google-chrome-stable")) {
    options.executablePath = "/usr/bin/google-chrome-stable";
  }
  return options;
}

const main = (page) => page.locator("main").first();

async function settle(page) {
  await main(page).waitFor({ state: "visible", timeout: T });
  await page.waitForTimeout(SETTLE_MS);
}

async function pressEscape(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

async function clickHeader(page, name) {
  await page.getByRole("button", { name }).first().click({ timeout: T });
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
  const named = main(page).getByRole("button", { name: /^formatter@/ });
  if (await named.count()) {
    await named.first().click({ timeout: T });
    return;
  }
  await main(page)
    .getByRole("listitem")
    .first()
    .getByRole("button")
    .first()
    .click({ timeout: T });
}

async function clickFirstDiscoverRow(page) {
  await main(page)
    .getByRole("list")
    .first()
    .getByRole("listitem")
    .first()
    .getByRole("button")
    .first()
    .click({ timeout: T });
}

/**
 * Each step drives the page to a screen; the harness screenshots after it
 * returns. `after` runs post-screenshot (e.g. Escape to close an overlay).
 */
const SCREENS = [
  {
    name: "scope-global",
    run: async (page) => {
      await clickHeader(page, /global scope/i);
    },
  },
  {
    name: "scope-project",
    run: async (page) => {
      await clickHeader(page, /project scope/i);
    },
  },
  {
    name: "library-list",
    run: async (page) => {
      await openLibrary(page);
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
      await page.getByRole("button", { name: /create resource/i }).first().click({ timeout: T });
    },
    after: pressEscape,
  },
  {
    name: "discover-list",
    run: async (page) => {
      await clickHeader(page, /^discover$/i);
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
    name: "settings-harnesses",
    run: async (page) => {
      await openSettings(page);
      await openSettingsTab(page, "Harnesses");
    },
  },
  {
    name: "settings-project",
    run: async (page) => {
      await openSettings(page);
      await openSettingsTab(page, "Project");
    },
  },
  {
    name: "settings-advanced",
    run: async (page) => {
      await openSettings(page);
      await openSettingsTab(page, "Advanced");
    },
    after: pressEscape,
  },
  {
    name: "export",
    run: async (page) => {
      await clickHeader(page, /^export setup$/i);
    },
    after: pressEscape,
  },
  {
    name: "import",
    run: async (page) => {
      await clickHeader(page, /^import setup$/i);
    },
    after: pressEscape,
  },
  {
    name: "account",
    run: async (page) => {
      await clickHeader(page, /^account$/i);
    },
    after: pressEscape,
  },
];

async function waitForConnected(page) {
  await settle(page);
  const banner = page.getByText(/waiting for sidecar health check/i);
  await banner.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {
    console.warn("shots: sidecar banner still visible after 15s; continuing");
  });
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
      report.consoleErrors.push(`[${tag}] ${message.text()}`);
    }
  });

  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForConnected(page);

  for (let index = 0; index < SCREENS.length; index++) {
    const screen = SCREENS[index];
    const file = path.join(
      config.outDir,
      `${String(index + 1).padStart(2, "0")}-${screen.name}-${tag}.png`,
    );
    try {
      await screen.run(page);
      await settle(page);
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

  await context.close();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const config = {
    baseUrl: process.env.SHOTS_BASE_URL ?? "http://127.0.0.1:5173/",
    agentPort: Number(process.env.SHOTS_AGENT_PORT ?? 7474),
    tokenPath: process.env.SHOTS_TOKEN_PATH ?? "/tmp/htdemo/home/.harnesstap/agent-token",
    projectPath: process.env.SHOTS_PROJECT_PATH ?? "/tmp/htdemo/project",
    outDir: process.env.SHOTS_OUT ? path.resolve(process.env.SHOTS_OUT) : DEFAULT_OUT,
    reducedMotion: args.reducedMotion,
    token: null,
  };
  config.token = await readToken(config.tokenPath);
  await mkdir(config.outDir, { recursive: true });

  const report = { written: [], stepFailures: [], pageErrors: [], consoleErrors: [] };
  const browser = await chromium.launch(launchOptions());
  try {
    for (const viewport of args.viewports) {
      await walkViewport(browser, viewport, config, report);
    }
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(`shots: ${report.written.length} screenshots in ${config.outDir}`);
  if (report.stepFailures.length) {
    console.log(`shots: ${report.stepFailures.length} step failure(s)`);
    for (const line of report.stepFailures) {
      console.log(`  ${line}`);
    }
  }
  if (report.consoleErrors.length) {
    console.log(`shots: ${report.consoleErrors.length} console error(s)`);
    for (const line of report.consoleErrors) {
      console.log(`  ${line}`);
    }
  }
  if (report.pageErrors.length) {
    console.log(`shots: ${report.pageErrors.length} pageerror(s)`);
    for (const line of report.pageErrors) {
      console.log(`  ${line}`);
    }
    process.exitCode = 1;
  } else {
    console.log("shots: 0 pageerrors");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
