import { describe, expect, it, spyOn } from "bun:test";
import { DEVICE_LOGIN_WAITING } from "../../src/copy/cli.ts";
import { printDeviceLoginInstructions } from "../../src/services/device-login-prompt.ts";

describe("device login waiting prompt", () => {
  it("prints visit, code, and the waiting line", () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...values) => {
      lines.push(values.map(String).join(" "));
    });
    try {
      const handle = printDeviceLoginInstructions({
        verificationUri: "https://example.test/device",
        userCode: "ABCD-EFGH",
      });
      handle.stop();
      expect(lines).toEqual([
        "Visit: https://example.test/device",
        "Code:  ABCD-EFGH",
        DEVICE_LOGIN_WAITING,
      ]);
      expect(DEVICE_LOGIN_WAITING).toBe(
        "Waiting for you to approve in the browser. The code expires in 15 minutes. Press Ctrl+C to cancel.",
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
