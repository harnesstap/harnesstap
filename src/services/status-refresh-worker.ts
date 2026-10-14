import { parentPort } from "node:worker_threads";
import { loadGlobalProfileStatusSnapshot } from "./global-profile-drift.js";

interface RefreshRequest {
  id: number;
  home?: string;
  userProfile?: string;
  harnesstapHome?: string;
  depth?: string;
  harness?: string;
  projectPath?: string;
  delayMs?: number;
}

function applyEnv(request: RefreshRequest): void {
  if (request.home) process.env.HOME = request.home;
  if (request.userProfile) process.env.USERPROFILE = request.userProfile;
  if (request.harnesstapHome) {
    process.env.HARNESSTAP_HOME = request.harnesstapHome;
  } else {
    delete process.env.HARNESSTAP_HOME;
  }
}

function depthOf(depth: string | undefined): "fast" | "full" {
  return depth === "fast" ? "fast" : "full";
}

parentPort?.on("message", (request: RefreshRequest) => {
  void (async () => {
    try {
      applyEnv(request);
      if (request.delayMs && request.delayMs > 0) {
        const shared = new SharedArrayBuffer(4);
        Atomics.wait(new Int32Array(shared), 0, 0, request.delayMs);
      }
      const loaded = await loadGlobalProfileStatusSnapshot({
        depth: depthOf(request.depth),
        harness: request.harness,
        projectPath: request.projectPath,
      });
      parentPort?.postMessage({
        id: request.id,
        ok: true,
        value: JSON.parse(JSON.stringify(loaded.value)),
        watchedPaths: loaded.watchedPaths,
      });
    } catch (error) {
      parentPort?.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
