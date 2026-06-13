import { join } from "node:path";
import { runCli } from "./cli.ts";

const BUILTIN_FIXTURE_DIR = join(import.meta.dirname, "../fixtures/builtin-plugins");

export async function importBuiltinFixtures(): Promise<void> {
  await runCli(["layer", "import", join(BUILTIN_FIXTURE_DIR, "nextjs-fullstack.json")]);
  await runCli(["layer", "import", join(BUILTIN_FIXTURE_DIR, "python-fastapi.json")]);
}
