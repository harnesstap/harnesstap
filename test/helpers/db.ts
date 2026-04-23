import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createTempDir } from "./fs.ts";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const ORIGINAL_CWD = process.cwd();

export interface TestContext {
  rootDir: string;
  homeDir: string;
  projectDir: string;
  connection: typeof import("../../src/db/connection.ts");
  schema: typeof import("../../src/db/schema.ts");
  cleanup: () => Promise<void>;
}

export async function createTestContext(
  prefix = "harnessdeck-test",
): Promise<TestContext> {
  const rootDir = createTempDir(prefix);
  const homeDir = join(rootDir, "home");
  const projectDir = join(rootDir, "project");

  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.chdir(projectDir);

  const connection = await import("../../src/db/connection.ts");
  const schema = await import("../../src/db/schema.ts");

  return {
    rootDir,
    homeDir,
    projectDir,
    connection,
    schema,
    async cleanup() {
      connection.closeDb();
      process.env.HOME = ORIGINAL_HOME;
      if (ORIGINAL_USERPROFILE === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = ORIGINAL_USERPROFILE;
      }
      process.chdir(ORIGINAL_CWD);
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

export async function createInitializedTestContext(
  prefix = "harnessdeck-test",
): Promise<TestContext> {
  const context = await createTestContext(prefix);
  context.schema.initializeSchema(context.connection.getDb());
  return context;
}
