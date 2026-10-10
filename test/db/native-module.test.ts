import { describe, expect, it, spyOn } from "bun:test";
import {
  isNativeModuleMismatch,
  NATIVE_MODULE_MISMATCH_MESSAGE,
  reportNativeModuleMismatch,
} from "../../src/db/native-module.ts";

describe("native sqlite module mismatch", () => {
  it("detects ERR_DLOPEN_FAILED and NODE_MODULE_VERSION errors", () => {
    expect(
      isNativeModuleMismatch(
        Object.assign(new Error("dlopen failed"), { code: "ERR_DLOPEN_FAILED" }),
      ),
    ).toBe(true);
    expect(
      isNativeModuleMismatch(
        new Error(
          "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 137.",
        ),
      ),
    ).toBe(true);
    expect(isNativeModuleMismatch(new Error("UNIQUE constraint failed"))).toBe(false);
  });

  it("prints one actionable line and exits 1 without throwing further", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as typeof process.exit);

    expect(() => reportNativeModuleMismatch()).toThrow("exit");
    expect(error.mock.calls).toEqual([[NATIVE_MODULE_MISMATCH_MESSAGE]]);
    expect(exit).toHaveBeenCalledWith(1);

    error.mockRestore();
    exit.mockRestore();
  });
});
