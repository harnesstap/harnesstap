import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHarnessdeckDir } from "../db/connection.js";

function readActiveEnvironmentName(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { name?: string };
    if (typeof raw.name === "string" && raw.name.length > 0) {
      return raw.name;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function writeActiveEnvironmentName(filePath: string, name: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ name }, null, 2)}\n`, "utf-8");
}

export function environmentSessionKey(): string {
  const fromEnv = process.env.HARNESSDECK_SESSION;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return String(process.ppid);
}

export function globalActiveEnvironmentPath(): string {
  return join(getHarnessdeckDir(), "active-environment.json");
}

export function localActiveEnvironmentPath(): string {
  return join(
    getHarnessdeckDir(),
    "sessions",
    environmentSessionKey(),
    "active-environment.json",
  );
}

export function getGlobalActiveEnvironmentName(): string | undefined {
  return readActiveEnvironmentName(globalActiveEnvironmentPath());
}

export function getLocalActiveEnvironmentName(): string | undefined {
  const fromEnv = process.env.HARNESSDECK_LOCAL_ENVIRONMENT;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return readActiveEnvironmentName(localActiveEnvironmentPath());
}

export function getEffectiveActiveEnvironmentName(): string | undefined {
  return getLocalActiveEnvironmentName() ?? getGlobalActiveEnvironmentName();
}

export function setGlobalActiveEnvironment(name: string): string {
  const filePath = globalActiveEnvironmentPath();
  writeActiveEnvironmentName(filePath, name);
  return filePath;
}

export function setLocalActiveEnvironment(name: string): string {
  const filePath = localActiveEnvironmentPath();
  writeActiveEnvironmentName(filePath, name);
  return filePath;
}
