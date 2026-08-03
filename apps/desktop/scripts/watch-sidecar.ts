#!/usr/bin/env bun
/**
 * Rebuild the desktop ht-agent sidecar when agent/library sources change.
 * Writes a reload stamp that the Tauri shell watches to restart the sidecar
 * without relaunching `tauri dev`.
 */
import { watch } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const WATCH_ROOTS = ["src", "package.json"];
const DEBOUNCE_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let rebuilding = false;
let pending = false;

async function rebuild(): Promise<void> {
  if (rebuilding) {
    pending = true;
    return;
  }
  rebuilding = true;
  pending = false;
  console.log("[sidecar-watch] rebuilding ht-agent…");
  const started = Date.now();
  const proc = Bun.spawn(["bash", "apps/desktop/scripts/prepare-sidecar.sh"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) {
    console.log(`[sidecar-watch] ready in ${Date.now() - started}ms (sidecar will restart)`);
  } else {
    console.error(`[sidecar-watch] prepare-sidecar failed (exit ${code})`);
  }
  rebuilding = false;
  if (pending) {
    void rebuild();
  }
}

function scheduleRebuild(reason: string): void {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    console.log(`[sidecar-watch] change: ${reason}`);
    void rebuild();
  }, DEBOUNCE_MS);
}

console.log("[sidecar-watch] watching src/ for agent changes");
for (const relative of WATCH_ROOTS) {
  const target = join(ROOT, relative);
  try {
    watch(target, { recursive: true }, (_event, filename) => {
      const name = filename?.toString() ?? relative;
      // Ignore noise that cannot affect the compiled sidecar.
      if (
        name.includes("node_modules")
        || name.includes(".git/")
        || name.endsWith(".md")
        || name.endsWith(".png")
        || name.endsWith(".svg")
      ) {
        return;
      }
      scheduleRebuild(name);
    });
  } catch (error) {
    console.error(`[sidecar-watch] failed to watch ${relative}:`, error);
  }
}

// Keep the process alive.
await new Promise(() => {});
