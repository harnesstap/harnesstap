import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

interface ActiveProfileFile {
  name: string;
}

function getActiveProfilePath(): string {
  return join(getHarnesstapDir(), "active-profile.json");
}

export function getActiveProfileName(): string | undefined {
  const filePath = getActiveProfilePath();
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<ActiveProfileFile>;
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      return parsed.name;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function setActiveProfileName(name: string): void {
  const home = getHarnesstapDir();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    getActiveProfilePath(),
    `${JSON.stringify({ name } satisfies ActiveProfileFile, null, 2)}\n`,
    "utf-8",
  );
}

export function clearActiveProfileName(): void {
  rmSync(getActiveProfilePath(), { force: true });
}
