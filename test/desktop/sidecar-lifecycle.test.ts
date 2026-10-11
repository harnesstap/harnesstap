import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const libRs = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src-tauri/src/lib.rs"),
  "utf8",
);
const entryTs = readFileSync(join(import.meta.dir, "../../src/agent/entry.ts"), "utf8");
const parentWatchTs = readFileSync(
  join(import.meta.dir, "../../src/agent/parent-watch.ts"),
  "utf8",
);
const sidecarCheckTs = readFileSync(
  join(import.meta.dir, "../../scripts/check-compiled-sidecar.ts"),
  "utf8",
);
const demoHomeSh = readFileSync(
  join(import.meta.dir, "../../apps/desktop/scripts/demo-home.sh"),
  "utf8",
);

describe("desktop sidecar lifecycle (DT-10)", () => {
  it("pipes stdin and stops the agent on SIGTERM, SIGINT, Exit, and ExitRequested", () => {
    expect(libRs).toContain("stdin(Stdio::piped())");
    expect(libRs).toContain("ctrlc::set_handler");
    expect(libRs).toContain("tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested");
    expect(libRs).toContain("stop_managed_process");
    expect(entryTs).toContain('process.on("SIGINT", shutdown)');
    expect(entryTs).toContain('process.on("SIGTERM", shutdown)');
    expect(entryTs).toContain("installAgentParentWatch");
    expect(parentWatchTs).toContain("stdinIsParentPipe");
    expect(parentWatchTs).toContain("isFIFO()");
    expect(sidecarCheckTs).toContain('stdio: ["pipe", "pipe", "pipe"]');
    expect(demoHomeSh).toContain("exec bun src/agent/entry.ts </dev/null");
  });
});
