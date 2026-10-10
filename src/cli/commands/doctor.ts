import { createRequire } from "node:module";
import type { Command } from "commander";
import { getDb, getDbPath, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { isNativeModuleMismatch } from "../../db/native-module.js";
import { getHarnessPreference } from "../../models/harness.js";
import { detectPlatforms } from "../../services/scanner.js";
import { registeredHarnessesOf } from "../../services/harness-targets.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { fail } from "../shared.js";

const require = createRequire(import.meta.url);

function nativeModuleStatus(): {
  ok: boolean;
  engine: string;
  detail?: string;
} {
  if ("Bun" in globalThis) {
    return { ok: true, engine: "bun:sqlite" };
  }
  try {
    require("better-sqlite3");
    return { ok: true, engine: "better-sqlite3" };
  } catch (error) {
    return {
      ok: false,
      engine: "better-sqlite3",
      detail: isNativeModuleMismatch(error)
        ? "NODE_MODULE_VERSION mismatch"
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

export function handleDoctorCommand(opts: { format?: string }): void {
  const format = parseOutputFormat(opts.format);
  const db = getDb();
  initializeSchema(db);
  const homeRoot = resolveHomeRoot();
  const native = nativeModuleStatus();
  const preference = getHarnessPreference();
  const payload = {
    node: process.version,
    native_module: native,
    paths: {
      home: homeRoot,
      harnesstap: getHarnesstapDir(),
      database: getDbPath(),
    },
    harnesses: {
      registered: preference ? registeredHarnessesOf(preference) : [],
      detected: detectPlatforms(homeRoot),
    },
  };

  if (format === "json") {
    printJson(payload);
    if (!native.ok) {
      process.exitCode = 1;
    }
    return;
  }

  ui.kvBlock([
    { key: "Node", value: payload.node },
    {
      key: "Native module",
      value: native.ok
        ? native.engine
        : `${native.engine} (${native.detail ?? "failed"})`,
    },
    { key: "HOME", value: payload.paths.home },
    { key: "HarnessTap dir", value: payload.paths.harnesstap },
    { key: "Database", value: payload.paths.database },
    {
      key: "Registered harnesses",
      value: payload.harnesses.registered.join(", ") || "(none)",
    },
    {
      key: "Detected on disk",
      value: payload.harnesses.detected.join(", ") || "(none)",
    },
  ]);

  if (!native.ok) {
    fail(`Native module check failed: ${native.detail ?? native.engine}.`);
  }
}

export function registerDoctorCommand(root: Command): void {
  root
    .command("doctor")
    .description("Check Node, native modules, paths, and harness detection")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((opts: { format?: string }) => {
      handleDoctorCommand(opts);
    });
}
