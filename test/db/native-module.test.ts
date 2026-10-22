import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  isNativeModuleMismatch,
  isSqliteModuleMissing,
  NATIVE_MODULE_MISMATCH_MESSAGE,
  reportNativeModuleMismatch,
  SQLITE_MODULE_MISSING_MESSAGE,
  withNativeModuleGuard,
} from "../../src/db/native-module.ts";

describe("native sqlite module mismatch", () => {
  const originalDebug = process.env.HARNESSTAP_DEBUG;

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.HARNESSTAP_DEBUG;
    } else {
      process.env.HARNESSTAP_DEBUG = originalDebug;
    }
  });

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

  it("prints only the DS-6 one-liner and exits 1", () => {
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

  it("catches a constructor-time ERR_DLOPEN and hides the raw text unless debug is set", () => {
    const mismatch = Object.assign(
      new Error(
        "Error: /usr/lib/better_sqlite3.node: undefined symbol: napi_create_buffer\nwas compiled against a different Node.js version using NODE_MODULE_VERSION 127.\nThis version of Node.js requires NODE_MODULE_VERSION 137.\nPlease try re-compiling or re-installing the module.\nERR_DLOPEN_FAILED",
      ),
      { code: "ERR_DLOPEN_FAILED" },
    );
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as typeof process.exit);

    delete process.env.HARNESSTAP_DEBUG;
    expect(() =>
      withNativeModuleGuard(() => {
        throw mismatch;
      }),
    ).toThrow("exit");
    expect(error.mock.calls).toEqual([[NATIVE_MODULE_MISMATCH_MESSAGE]]);
    expect(NATIVE_MODULE_MISMATCH_MESSAGE).toBe(
      "HarnessTap was installed under a different Node.js version. Run: npm rebuild -g harnesstap",
    );

    error.mockClear();
    process.env.HARNESSTAP_DEBUG = "1";
    expect(() =>
      withNativeModuleGuard(() => {
        throw mismatch;
      }),
    ).toThrow("exit");
    expect(error.mock.calls[0]?.[0]).toBe(mismatch);
    expect(error.mock.calls[1]).toEqual([NATIVE_MODULE_MISMATCH_MESSAGE]);

    error.mockRestore();
    exit.mockRestore();
  });

  it("prints one line naming the fix when better-sqlite3 did not install (#501)", () => {
    const missing = Object.assign(
      new Error("Cannot find module 'better-sqlite3'\nRequire stack:\n- /usr/lib/node_modules/harnesstap/dist/bin.js"),
      { code: "MODULE_NOT_FOUND" },
    );
    expect(isSqliteModuleMissing(missing)).toBe(true);
    expect(isSqliteModuleMissing(Object.assign(new Error("Cannot find module 'chalk'"), { code: "MODULE_NOT_FOUND" }))).toBe(false);
    expect(isSqliteModuleMissing(new Error("Could not locate the bindings file. Tried: better_sqlite3.node"))).toBe(true);

    delete process.env.HARNESSTAP_DEBUG;
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as typeof process.exit);
    try {
      expect(() =>
        withNativeModuleGuard(() => {
          throw missing;
        }),
      ).toThrow("exit");
      expect(error.mock.calls).toEqual([[SQLITE_MODULE_MISSING_MESSAGE]]);
      expect(SQLITE_MODULE_MISSING_MESSAGE).toContain("bun x --bun harnesstap@latest");
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });
});
