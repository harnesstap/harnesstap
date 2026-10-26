import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatAgentStartError } from "../../apps/desktop/src/lib/agent-start-error.ts";
import {
  AUTO_RESTART_AFTER_FAILURES,
  MAX_AUTO_RESTARTS,
  shouldAutoRestartAgent,
} from "../../apps/desktop/src/state/agent-session.ts";
import {
  AGENT_START_COPY,
  CONNECT_SPLASH_COPY,
} from "../../apps/desktop/src/lib/ui-copy.ts";

describe("formatAgentStartError", () => {
  it("maps HT_FATAL codes and Failed to fetch to splash copy", () => {
    expect(
      formatAgentStartError(
        `HT_FATAL ${JSON.stringify({
          code: "newer_schema",
          message: "Database schema is newer than this HarnessTap build.",
        })}`,
      ),
    ).toBe(AGENT_START_COPY.newerSchema);
    expect(
      formatAgentStartError('Failed to fetch'),
    ).toBe(CONNECT_SPLASH_COPY.unreachable);
    expect(formatAgentStartError("Sidecar connection failed")).toBe(
      CONNECT_SPLASH_COPY.unreachable,
    );
    expect(
      formatAgentStartError("Can't reach the HarnessTap agent", `HT_FATAL ${JSON.stringify({
        code: "newer_schema",
        message: "Database schema is newer than this HarnessTap build.",
      })}`),
    ).toBe(AGENT_START_COPY.newerSchema);
    expect(AGENT_START_COPY.newerSchema).not.toMatch(/sidecar/i);
    expect(CONNECT_SPLASH_COPY.unreachable).toBe(
      "Can't reach the HarnessTap agent. It may still be starting.",
    );
    expect(CONNECT_SPLASH_COPY.reconnecting).toBe("Reconnecting to the HarnessTap agent...");
    expect(CONNECT_SPLASH_COPY.starting).toBe("Starting the agent");
  });

  it("keeps an unclassified crash dump out of the headline", () => {
    const detail = "Error: boom\nLog file: /tmp/ht-agent.log";
    expect(formatAgentStartError(detail)).toBe(CONNECT_SPLASH_COPY.unexpectedStop);
    expect(formatAgentStartError(detail)).not.toContain("ht-agent.log");
    expect(formatAgentStartError("Database is locked")).toBe("Database is locked");
  });
});

describe("ConnectSplash copy", () => {
  it("wires splash strings from ui-copy and always offers Open logs", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/shell/ConnectSplash.tsx"),
      "utf8",
    );
    expect(source).toContain("CONNECT_SPLASH_COPY");
    expect(source).toContain("CONNECT_SPLASH_COPY.openLogs");
    expect(source).not.toContain("Failed to fetch");
    expect(source).not.toContain("Sidecar connection failed");
  });
});

describe("agent restart without commands", () => {
  it("restarts the agent automatically in the desktop app after it stays down", () => {
    expect(
      shouldAutoRestartAgent({ tauri: true, failedProbes: AUTO_RESTART_AFTER_FAILURES - 1, restartsSoFar: 0 }),
    ).toBe(false);
    expect(
      shouldAutoRestartAgent({ tauri: true, failedProbes: AUTO_RESTART_AFTER_FAILURES, restartsSoFar: 0 }),
    ).toBe(true);
    expect(
      shouldAutoRestartAgent({ tauri: true, failedProbes: AUTO_RESTART_AFTER_FAILURES, restartsSoFar: 1 }),
    ).toBe(false);
    expect(
      shouldAutoRestartAgent({ tauri: true, failedProbes: AUTO_RESTART_AFTER_FAILURES * 2, restartsSoFar: 1 }),
    ).toBe(true);
    expect(
      shouldAutoRestartAgent({ tauri: true, failedProbes: 1000, restartsSoFar: MAX_AUTO_RESTARTS }),
    ).toBe(false);
    expect(
      shouldAutoRestartAgent({ tauri: false, failedProbes: 1000, restartsSoFar: 0 }),
    ).toBe(false);
  });

  it("offers Restart agent on the splash and the reconnect banner", () => {
    const splash = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/shell/ConnectSplash.tsx"),
      "utf8",
    );
    expect(splash).toContain("CONNECT_SPLASH_COPY.restartAgent");
    expect(splash).toContain("retryLabel={CONNECT_SPLASH_COPY.restartAgent}");
    expect(CONNECT_SPLASH_COPY.restartAgent).toBe("Restart agent");
  });

  it("start errors point at Restart agent, never at a process or a folder to inspect", () => {
    expect(AGENT_START_COPY.portInUse).toContain("Restart agent");
    expect(AGENT_START_COPY.portInUse).not.toMatch(/7474|process/);
    expect(AGENT_START_COPY.homeNotWritable).toContain("Restart agent");
    expect(
      formatAgentStartError("ht-agent sidecar did not report its port"),
    ).toBe(CONNECT_SPLASH_COPY.unreachable);
    const rust = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src-tauri/src/lib.rs"),
      "utf8",
    );
    expect(rust).not.toContain("check ~/.harnesstap");
  });
});
