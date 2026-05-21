import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessdeckSettings {
  plugins: { refreshMaxAgeHours: number };
}

const DEFAULTS: HarnessdeckSettings = {
  plugins: { refreshMaxAgeHours: 24 },
};

export function loadSettings(harnessdeckDir: string): HarnessdeckSettings {
  const path = join(harnessdeckDir, "config.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<HarnessdeckSettings>;
    const hours = raw.plugins?.refreshMaxAgeHours;
    return {
      plugins: {
        refreshMaxAgeHours:
          typeof hours === "number" && hours > 0
            ? hours
            : DEFAULTS.plugins.refreshMaxAgeHours,
      },
    };
  } catch {
    return DEFAULTS;
  }
}
