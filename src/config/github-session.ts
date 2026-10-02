import fs from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

export interface GithubSession {
  clientId: string;
  accessToken: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  tokenType?: string;
  login?: string;
  userId?: number;
  name?: string;
}

export function getGithubSessionPath(): string {
  return join(getHarnesstapDir(), "github-session.json");
}

export function loadGithubSession(): GithubSession | null {
  const path = getGithubSessionPath();
  if (!fs.existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
    if (!isSession(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveGithubSession(session: GithubSession): void {
  const dir = getHarnesstapDir();
  fs.mkdirSync(dir, { recursive: true });
  const path = getGithubSessionPath();
  fs.writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf8",
  });
  try {
    fs.chmodSync(path, 0o600);
  } catch {
    // ignore on filesystems that don't support chmod
  }
}

export function clearGithubSession(): void {
  const path = getGithubSessionPath();
  if (!fs.existsSync(path)) {
    return;
  }
  try {
    fs.rmSync(path);
  } catch {
    saveGithubSession({
      clientId: "",
      accessToken: "",
    });
    fs.rmSync(path, { force: true });
  }
}

function isSession(value: unknown): value is GithubSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.clientId === "string"
    && typeof record.accessToken === "string"
    && record.accessToken.length > 0
  );
}
