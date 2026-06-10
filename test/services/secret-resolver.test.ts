import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSecretRef,
  resolveSecretRefs,
} from "../../src/services/secret-resolver.js";

describe("resolveSecretRef", () => {
  const envKey = "HD_TEST_SECRET_RESOLVER_TOKEN";
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
    const dir = mkdtempSync(join(tmpdir(), "hd-secret-file-"));
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
      resolveSecretRef({ provider: "file", ref: "/nonexistent/hd-secret-path" }),
    ).toThrow(/file/i);
  });

  it("throws actionable error for keychain provider", () => {
    expect(() => resolveSecretRef({ provider: "keychain", ref: "svc/token" })).toThrow(
      /keychain secret provider is not yet supported/i,
    );
  });
});

describe("resolveSecretRefs", () => {
  const envKey = "HD_TEST_SECRET_RESOLVER_BATCH";
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
