import { join } from "node:path";
import { runCli } from "./cli.ts";

const BUILTIN_FIXTURE_DIR = join(import.meta.dirname, "../fixtures/builtin-plugins");

export async function importBuiltinFixtures(): Promise<void> {
  await runCli(["migrate", "import", join(BUILTIN_FIXTURE_DIR, "demo-stack.harnesstap.toml")]);
  await runCli(["migrate", "import", join(BUILTIN_FIXTURE_DIR, "demo-api.harnesstap.toml")]);
}
