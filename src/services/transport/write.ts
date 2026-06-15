import { writeFileSync } from "node:fs";
import { stringify } from "smol-toml";
import { sortKeysDeep } from "./sort.js";

export function formatTransportToml(document: Record<string, unknown>): string {
  return `${stringify(sortKeysDeep(document))}\n`;
}

export function writeTransportToml(
  filePath: string,
  document: Record<string, unknown>,
): void {
  writeFileSync(filePath, formatTransportToml(document), "utf-8");
}
