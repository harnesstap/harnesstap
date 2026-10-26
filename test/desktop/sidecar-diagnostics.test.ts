import { describe, expect, it } from "bun:test";
import { formatSidecarDetail } from "../../apps/desktop/src/lib/sidecar-diagnostics.ts";
import { CONNECT_SPLASH_COPY } from "../../apps/desktop/src/lib/ui-copy.ts";

describe("formatSidecarDetail", () => {
  it("returns null when the agent never produced output or an exit status", () => {
    expect(formatSidecarDetail(null)).toBeNull();
    expect(formatSidecarDetail({ stderrTail: "  \n", exit: null, logPath: "/logs/ht-agent.log" })).toBeNull();
  });

  it("shows the stderr tail, exit status, and log file for a startup crash", () => {
    const detail = formatSidecarDetail({
      stderrTail: "error: Cannot find module '../package.json' from '/$bunfs/root/ht-agent'",
      exit: "exit status: 1",
      logPath: "/logs/ht-agent.log",
    });
    expect(detail).toContain("Agent exit: exit status: 1");
    expect(detail).toContain("Cannot find module '../package.json'");
    expect(detail).toContain("Log file: /logs/ht-agent.log");
  });

  it("explains an exit with no output", () => {
    const detail = formatSidecarDetail({ stderrTail: "", exit: "exit status: 1", logPath: null });
    expect(detail).toContain(CONNECT_SPLASH_COPY.detailsEmptyOutput);
  });
});

describe("connect splash copy", () => {
  it("uses ASCII punctuation only", () => {
    const blob = [
      CONNECT_SPLASH_COPY.starting,
      CONNECT_SPLASH_COPY.couldNotConnect,
      CONNECT_SPLASH_COPY.sidecarConnectionFailed,
      CONNECT_SPLASH_COPY.unreachable,
      CONNECT_SPLASH_COPY.reconnecting,
      CONNECT_SPLASH_COPY.retry,
      CONNECT_SPLASH_COPY.openLogs,
      CONNECT_SPLASH_COPY.openLogsFailed("permission denied"),
      CONNECT_SPLASH_COPY.openLogsFailed(""),
      CONNECT_SPLASH_COPY.detailsSummary,
      CONNECT_SPLASH_COPY.detailsEmptyOutput,
      CONNECT_SPLASH_COPY.detailsExit("exit status: 1"),
      CONNECT_SPLASH_COPY.detailsLogFile("/logs/ht-agent.log"),
    ].join("\n");
    expect(blob).not.toMatch(/[\u2013\u2014\u2026]/);
  });
});
