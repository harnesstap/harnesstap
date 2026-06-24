import { expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import * as cp from "../../src/config/cloud-accounts";

const tmpRoot = path.join(process.cwd(), "tmp-test-harnessdeck");

beforeEach(() => {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.HARNESSDECK_HOME = tmpRoot;
});

afterEach(() => {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
  delete process.env.HARNESSDECK_HOME;
});

test("round-trips a saved account under HARNESSDECK_HOME", async () => {
  const account = {
    cloudBaseUrl: "https://harnessdeck.kayrnt.fr",
    scopes: ["core"],
  };

  await cp.saveCloudAccount("my-account", account);
  const got = await cp.getCloudAccount("my-account");
  expect(got.accountName).toBe("my-account");
  expect(got.account).toBeTruthy();
  expect(got.account?.cloudBaseUrl).toBe("https://harnessdeck.kayrnt.fr");

  const p = cp.getCloudAccountsPath();
  expect(fs.existsSync(p)).toBe(true);
});

test("updates default account and clears token material on logout", async () => {
  const a1 = { cloudBaseUrl: "https://one", scopes: ["core"] };
  const a2 = { cloudBaseUrl: "https://two", scopes: ["core"] };

  await cp.saveCloudAccount("one", a1);
  await cp.saveCloudAccount("two", a2);

  await cp.setDefaultCloudAccount("one");
  let cur = await cp.loadCloudAccounts();
  expect(cur.default_account).toBe("one");

  await cp.setDefaultCloudAccount("two");
  cur = await cp.loadCloudAccounts();
  expect(cur.default_account).toBe("two");

  await cp.updateCloudAccount("two", {
    accessToken: "abc",
    refreshToken: "ref",
  });

  let got = await cp.getCloudAccount("two");
  expect(got.account?.accessToken).toBe("abc");
  expect(got.account?.refreshToken).toBe("ref");

  await cp.clearCloudTokens("two");
  got = await cp.getCloudAccount("two");
  expect(got.account?.accessToken).toBeUndefined();
  expect(got.account?.refreshToken).toBeUndefined();
});
