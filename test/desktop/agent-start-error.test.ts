import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatAgentStartError } from "../../apps/desktop/src/lib/agent-start-error.ts";
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
    expect(AGENT_START_COPY.newerSchema).not.toMatch(/sidecar/i);
    expect(CONNECT_SPLASH_COPY.unreachable).toBe("Can't reach the HarnessTap agent");
    expect(CONNECT_SPLASH_COPY.starting).toBe("Starting the agent");
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
