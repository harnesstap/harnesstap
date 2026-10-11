import { describe, expect, it } from "bun:test";
import {
  classifyAgentStartError,
  formatHtFatal,
  parseHtFatal,
} from "../../src/agent/fatal.ts";

describe("HT_FATAL", () => {
  it("round-trips a newer-schema payload", () => {
    const line = formatHtFatal({
      code: "newer_schema",
      message: "Database schema is newer than this HarnessTap build.",
    });
    expect(line.startsWith("HT_FATAL ")).toBe(true);
    expect(parseHtFatal(`noise\n${line}\n`)).toEqual({
      code: "newer_schema",
      message: "Database schema is newer than this HarnessTap build.",
    });
  });

  it("classifies schema, port, and permission errors", () => {
    expect(
      classifyAgentStartError(
        new Error("Database schema v33 is newer than this binary (v30)."),
      )?.code,
    ).toBe("newer_schema");
    const inUse = new Error("listen EADDRINUSE: address already in use");
    (inUse as Error & { code?: string }).code = "EADDRINUSE";
    expect(classifyAgentStartError(inUse)?.code).toBe("port_in_use");
    const denied = new Error("EACCES: permission denied");
    (denied as Error & { code?: string }).code = "EACCES";
    expect(classifyAgentStartError(denied)?.code).toBe("home_not_writable");
    expect(classifyAgentStartError(new Error("something else"))).toBeNull();
  });
});
