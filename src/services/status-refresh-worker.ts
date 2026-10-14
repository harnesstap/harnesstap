import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { resolveHomeRoot, setHomeRootOverride } from "../utils/home-root.js";
import { loadGlobalProfileStatusSnapshot } from "./global-profile-drift.js";
import {
  armStatusWatches,
  closeStatusWatches,
  releaseStatusWatchesForOtherHomes,
  collectFingerprintPaths,
} from "./status-read-cache.js";

interface RefreshRequest {
  op?: "pause-watches";
  id?: number;
  home?: string;
  userProfile?: string;
  harnesstapHome?: string;
  depth?: string;
  harness?: string;
  projectPath?: string;
  delayMs?: number;
}

function applyEnv(request: RefreshRequest): void {
  if (request.home) {
    process.env.HOME = request.home;
    setHomeRootOverride(request.home);
  }
  if (request.userProfile) process.env.USERPROFILE = request.userProfile;
  if (request.harnesstapHome) {
    process.env.HARNESSTAP_HOME = request.harnesstapHome;
  } else if (request.home) {
    // HOME itself cannot be changed in a Bun 1.3 worker. Point the database
    // at the request home so status does not read the worker's startup home.
    process.env.HARNESSTAP_HOME = join(request.home, ".harnesstap");
  } else {
    delete process.env.HARNESSTAP_HOME;
  }
}

function depthOf(depth: string | undefined): "fast" | "full" {
  return depth === "fast" ? "fast" : "full";
}

let chain: Promise<void> = Promise.resolve();

parentPort?.on("message", (request: RefreshRequest) => {
  if (request.op === "pause-watches") {
    closeStatusWatches();
    return;
  }
  const requestId = request.id;
  if (requestId === undefined) return;
  const run = chain.then(async () => {
    try {
      applyEnv(request);
      // Stop watching a previous home before this read, so its teardown
      // is not reported as an edit.
      releaseStatusWatchesForOtherHomes(resolveHomeRoot());
      if (request.delayMs && request.delayMs > 0) {
        const shared = new SharedArrayBuffer(4);
        Atomics.wait(new Int32Array(shared), 0, 0, request.delayMs);
      }
      const loaded = await loadGlobalProfileStatusSnapshot({
        depth: depthOf(request.depth),
        harness: request.harness,
        projectPath: request.projectPath,
      });
      const collected = collectFingerprintPaths(request.projectPath, loaded.watchedPaths);
      parentPort?.postMessage({
        id: requestId,
        ok: true,
        value: JSON.parse(JSON.stringify(loaded.value)),
        watchedPaths: loaded.watchedPaths,
        watchPaths: collected.paths,
      });
      // Watch after the result is queued so this thread's fs.watch cannot sit on the request.
      const created = armStatusWatches(collected.paths, collected.recursive, resolveHomeRoot());
      parentPort?.postMessage({ op: "watch-report", created });
    } catch (error) {
      parentPort?.postMessage({
        id: requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  chain = run.then(() => undefined, () => undefined);
});
