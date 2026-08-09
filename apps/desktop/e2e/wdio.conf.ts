import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createE2EIsolation, type E2EIsolation } from "./helpers/isolation.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const repoRoot = join(__dirname, "../../..");
const appBinaryPath = join(desktopDir, "src-tauri/target/debug/harnesstap-desktop");
const artifactsDir = join(__dirname, "artifacts");

let e2eIsolation: E2EIsolation | undefined;

type TauriCapability = {
  browserName: "tauri";
  "tauri:options": {
    application: string;
  };
  "wdio:tauriServiceOptions": {
    appBinaryPath: string;
    appArgs: string[];
    captureBackendLogs: boolean;
    captureFrontendLogs: boolean;
    backendLogLevel: "debug";
    frontendLogLevel: "debug";
  };
};

const capabilities: TauriCapability[] = [
  {
    browserName: "tauri",
    "tauri:options": {
      application: appBinaryPath,
    },
    "wdio:tauriServiceOptions": {
      appBinaryPath,
      appArgs: [],
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: "debug",
      frontendLogLevel: "debug",
    },
  },
];

export const config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts", "./specs/**/*.spec.ts"],
  exclude: [],
  maxInstances: 1,
  capabilities,
  logLevel: process.env.DEBUG ? "debug" : "info",
  logLevels: {
    webdriver: "info",
    "@wdio/tauri-service": "info",
  },
  bail: 0,
  baseUrl: "",
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: false,
  outputDir: join(__dirname, "logs"),
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  onPrepare: async () => {
    if (!existsSync(appBinaryPath)) {
      throw new Error(
        `Tauri binary not found: ${appBinaryPath}. Run \`bun run desktop:e2e:build\` first.`,
      );
    }

    mkdirSync(artifactsDir, { recursive: true });
    e2eIsolation = createE2EIsolation(repoRoot);
    Object.assign(process.env, e2eIsolation.env);
  },

  before: async () => {
    if (!e2eIsolation) {
      throw new Error("E2E isolation was not initialized in onPrepare");
    }
    browser.e2eIsolation = e2eIsolation;
  },

  afterTest: async (test: { title: string }, _context: unknown, { error }: { error?: Error }) => {
    if (!error) {
      return;
    }

    const safeName = test.title.replace(/[^\w-]+/g, "_").slice(0, 120);
    const screenshotPath = join(artifactsDir, `${safeName}.png`);
    await browser.saveScreenshot(screenshotPath);
  },

  onComplete: async () => {
    e2eIsolation?.cleanup();
    e2eIsolation = undefined;
  },
};
