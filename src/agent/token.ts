import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

export const AGENT_TOKEN_FILENAME = "agent-token";
export const AGENT_PORT_FILENAME = "agent-port";

export function getAgentTokenPath(): string {
  return join(getHarnesstapDir(), AGENT_TOKEN_FILENAME);
}

export function getAgentPortPath(): string {
  return join(getHarnesstapDir(), AGENT_PORT_FILENAME);
}

export function generateAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function writeAgentTokenFile(token: string): string {
  const tokenPath = getAgentTokenPath();
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return tokenPath;
}

export function writeAgentPortFile(port: number): string {
  const portPath = getAgentPortPath();
  writeFileSync(portPath, `${port}\n`, { encoding: "utf8", mode: 0o600 });
  return portPath;
}

export function readAgentTokenFile(): string | null {
  const tokenPath = getAgentTokenPath();
  if (!existsSync(tokenPath)) {
    return null;
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  return token.length > 0 ? token : null;
}

export function readAgentPortFile(): number | null {
  const portPath = getAgentPortPath();
  if (!existsSync(portPath)) {
    return null;
  }
  const raw = readFileSync(portPath, "utf8").trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }
  return port;
}
