import { expect, test, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Tests reference the module which does not exist yet (TDD failing test)
import * as cp from "../../src/config/cloud-profiles";

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

test("round-trips a saved profile under HARNESSDECK_HOME", async () => {
  const profile = {
    cloudBaseUrl: "https://app.harness.io",
    scopes: ["core"],
  } as any;

  await cp.saveCloudProfile("my-profile", profile);
  const got = await cp.getCloudProfile("my-profile");
  expect(got.profileName).toBe("my-profile");
  expect(got.profile).toBeTruthy();
  expect(got.profile.cloudBaseUrl).toBe("https://app.harness.io");

  // Also verify file exists
  const p = cp.getCloudProfilesPath();
  expect(fs.existsSync(p)).toBe(true);
});

test("updates default profile and clears token material on logout", async () => {
  const p1 = { cloudBaseUrl: "https://one", scopes: ["core"] } as any;
  const p2 = { cloudBaseUrl: "https://two", scopes: ["core"] } as any;

  await cp.saveCloudProfile("one", p1);
  await cp.saveCloudProfile("two", p2);

  await cp.setDefaultCloudProfile("one");
  let cur = await cp.loadCloudProfiles();
  expect(cur.default_profile).toBe("one");

  await cp.setDefaultCloudProfile("two");
  cur = await cp.loadCloudProfiles();
  expect(cur.default_profile).toBe("two");

  // set token material on profile two
  await cp.updateCloudProfile("two", {
    accessToken: "abc",
    refreshToken: "ref",
  });

  let got = await cp.getCloudProfile("two");
  expect(got.profile.accessToken).toBe("abc");
  expect(got.profile.refreshToken).toBe("ref");

  await cp.clearCloudTokens("two");
  got = await cp.getCloudProfile("two");
  expect(got.profile.accessToken).toBeUndefined();
  expect(got.profile.refreshToken).toBeUndefined();
});
