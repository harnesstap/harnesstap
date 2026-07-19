import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSecretRef,
  resolveSecretRefs,
  resolveSecretRefsBestEffort,
} from "../../src/services/secret-resolver.js";

describe("resolveSecretRef", () => {
  const envKey = "HT_TEST_SECRET_RESOLVER_TOKEN";
  const previousValue = process.env[envKey];

  afterEach(() => {
    if (previousValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousValue;
    }
  });

  it("reads env provider from process.env", () => {
    process.env[envKey] = "secret-value";
    expect(resolveSecretRef({ provider: "env", ref: envKey })).toBe("secret-value");
  });

  it("throws when env provider ref is missing", () => {
    delete process.env[envKey];
    expect(() => resolveSecretRef({ provider: "env", ref: envKey })).toThrow(
      /environment variable/i,
    );
  });

  it("reads file provider from path and trims trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-secret-file-"));
    try {
      const filePath = join(dir, "token.txt");
      writeFileSync(filePath, "file-secret\n", "utf-8");
      expect(resolveSecretRef({ provider: "file", ref: filePath })).toBe("file-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when file provider path is missing", () => {
    expect(() =>
      resolveSecretRef({ provider: "file", ref: "/nonexistent/ht-secret-path" }),
    ).toThrow(/file/i);
  });

  it("throws on non-darwin keychain platforms", () => {
    if (process.platform === "darwin") {
      return;
    }
    expect(() => resolveSecretRef({ provider: "keychain", ref: "svc/token" })).toThrow(
      /only supported on macOS/i,
    );
  });

  it("throws when keychain item is missing on darwin", () => {
    if (process.platform !== "darwin") {
      return;
    }
    expect(() =>
      resolveSecretRef({
        provider: "keychain",
        ref: "harnesstap/__missing_ht_secret_item__",
      }),
    ).toThrow(/keychain item/i);
  });
});

describe("resolveSecretRefs", () => {
  const envKey = "HT_TEST_SECRET_RESOLVER_BATCH";
  const previousValue = process.env[envKey];

  afterEach(() => {
    if (previousValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousValue;
    }
  });

  it("resolves multiple secret refs by key", () => {
    process.env[envKey] = "batch-secret";
    expect(
      resolveSecretRefs({
        API_TOKEN: { provider: "env", ref: envKey },
      }),
    ).toEqual({ API_TOKEN: "batch-secret" });
  });
});

describe("resolveSecretRefsBestEffort", () => {
  const envKey = "HT_TEST_SECRET_RESOLVER_BEST_EFFORT";
  const previousValue = process.env[envKey];

  afterEach(() => {
    if (previousValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousValue;
    }
  });

  it("returns warnings instead of throwing for unresolved refs", () => {
    delete process.env[envKey];
    const result = resolveSecretRefsBestEffort({
      API_TOKEN: { provider: "env", ref: envKey },
      FILE_TOKEN: { provider: "file", ref: "/nonexistent/ht-secret-path" },
    });

    expect(result.resolved).toEqual({});
    expect(result.warnings).toEqual([
      expect.objectContaining({ key: "API_TOKEN" }),
      expect.objectContaining({ key: "FILE_TOKEN" }),
    ]);
  });

  it("returns resolved values alongside warnings", () => {
    process.env[envKey] = "resolved-secret";
    const result = resolveSecretRefsBestEffort({
      API_TOKEN: { provider: "env", ref: envKey },
      FILE_TOKEN: { provider: "file", ref: "/nonexistent/ht-secret-path" },
    });

    expect(result.resolved).toEqual({ API_TOKEN: "resolved-secret" });
    expect(result.warnings).toEqual([
      expect.objectContaining({ key: "FILE_TOKEN" }),
    ]);
  });
});
