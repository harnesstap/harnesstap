import { describe, expect, it, spyOn } from "bun:test";
import {
  assertSupportedRuntime,
  isSupportedNodeVersion,
  nodeVersionRefusalMessage,
} from "../../src/node-version.ts";

describe("Node version support", () => {
  it("rejects Node 20 and Node 22 below 22.12", () => {
    expect(isSupportedNodeVersion("20.19.0")).toBe(false);
    expect(isSupportedNodeVersion("22.11.0")).toBe(false);
    expect(isSupportedNodeVersion("21.7.3")).toBe(false);
  });

  it("accepts Node 22.12+ and Node 24", () => {
    expect(isSupportedNodeVersion("22.12.0")).toBe(true);
    expect(isSupportedNodeVersion("22.18.0")).toBe(true);
    expect(isSupportedNodeVersion("24.4.0")).toBe(true);
  });

  it("prints a refusal and exits 1 on unsupported Node", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as typeof process.exit);

    expect(() =>
      assertSupportedRuntime({ node: "20.19.0" } as NodeJS.ProcessVersions),
    ).toThrow("exit");
    expect(error).toHaveBeenCalledWith(nodeVersionRefusalMessage("20.19.0"));
    expect(exit).toHaveBeenCalledWith(1);

    error.mockRestore();
    exit.mockRestore();
  });

  it("skips the Node floor when running under Bun", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as typeof process.exit);

    assertSupportedRuntime({ node: "20.19.0", bun: "1.3.9" } as NodeJS.ProcessVersions);
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    error.mockRestore();
    exit.mockRestore();
  });
});
