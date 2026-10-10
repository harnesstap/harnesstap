import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(
  metaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) {
    return false;
  }

  try {
    const invoked = realpathSync(argv1);
    const self = realpathSync(fileURLToPath(metaUrl));
    return invoked === self;
  } catch {
    return false;
  }
}
