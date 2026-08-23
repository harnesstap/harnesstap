#!/usr/bin/env bun
/**
 * Build the Tauri desktop app and install the macOS bundle into /Applications.
 * Never touches /Applications when the build fails or the bundle is missing.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const BUNDLE_APP = join(
  ROOT,
  "apps/desktop/src-tauri/target/release/bundle/macos/HarnessTap.app",
);
const INSTALL_DIR = "/Applications";
const INSTALLED_APP = join(INSTALL_DIR, "HarnessTap.app");

async function run(command: string[]): Promise<number> {
  const proc = Bun.spawn(command, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function quitRunningApp(): Promise<void> {
  const probe = Bun.spawn(["pgrep", "-x", "HarnessTap"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await probe.exited) !== 0) {
    return;
  }
  console.log("[install] HarnessTap is running; quitting it…");
  await run(["osascript", "-e", 'tell application "HarnessTap" to quit']);
}

console.log("[install] building desktop app (bun run desktop:build)…");
const buildCode = await run(["bun", "run", "desktop:build"]);
if (buildCode !== 0) {
  console.error(`[install] build failed (exit ${buildCode}); /Applications left untouched`);
  process.exit(buildCode);
}

if (!existsSync(BUNDLE_APP)) {
  console.error(`[install] expected bundle not found at ${BUNDLE_APP}`);
  process.exit(1);
}

await quitRunningApp();

await run(["rm", "-rf", INSTALLED_APP]);
await run(["cp", "-R", BUNDLE_APP, INSTALL_DIR]);

console.log(`[install] installed ${INSTALLED_APP}`);
