import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

export const AGENT_TOKEN_FILENAME = "agent-token";

export function getAgentTokenPath(): string {
  return join(getHarnesstapDir(), AGENT_TOKEN_FILENAME);
}

export function generateAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function writeAgentTokenFile(token: string): string {
  const tokenPath = getAgentTokenPath();
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return tokenPath;
}
