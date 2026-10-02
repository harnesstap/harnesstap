import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import * as session from "../../src/config/github-session";

const tmpRoot = path.join(process.cwd(), "tmp-test-github-session");

beforeEach(() => {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.HARNESSTAP_HOME = tmpRoot;
});

afterEach(() => {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
  delete process.env.HARNESSTAP_HOME;
});

test("round-trips a GitHub session with 0600 mode", () => {
  session.saveGithubSession({
    clientId: "Iv23liiaeCAUoGKe2uUx",
    accessToken: "ghu_test",
    login: "octocat",
  });
  const loaded = session.loadGithubSession();
  expect(loaded?.accessToken).toBe("ghu_test");
  expect(loaded?.login).toBe("octocat");
  const mode = fs.statSync(session.getGithubSessionPath()).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("clearGithubSession removes the file", () => {
  session.saveGithubSession({
    clientId: "Iv23liiaeCAUoGKe2uUx",
    accessToken: "ghu_test",
  });
  session.clearGithubSession();
  expect(session.loadGithubSession()).toBeNull();
  expect(fs.existsSync(session.getGithubSessionPath())).toBe(false);
});
