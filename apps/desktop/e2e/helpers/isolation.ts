import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PROJECT_RESOURCE_NAMES, USER_RESOURCE_NAMES } from "./seed.ts";

export interface E2EIsolation {
  root: string;
  home: string;
  harnesstapHome: string;
  project: string;
  marketplaceRepo: string;
  env: Record<string, string>;
  cleanup(): void;
}

export interface E2EIsolationPaths {
  project: string;
  marketplaceRepo: string;
  home: string;
}

export const E2E_ISOLATION_STATE_PATH = join(tmpdir(), "harnesstap-e2e-isolation.json");

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

function seedClaudeCommand(baseDir: string, name: string): void {
  writeTextFile(join(baseDir, ".claude", "commands", `${name}.md`), `# ${name}\n`);
}

function seedClaudeAgent(baseDir: string, name: string): void {
  writeTextFile(join(baseDir, ".claude", "agents", `${name}.md`), `# ${name}\n`);
}

function seedClaudeSkill(baseDir: string, name: string): void {
  writeTextFile(
    join(baseDir, ".claude", "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: HarnessTap desktop E2E ${name}\n---\n# ${name}\n`,
  );
}

function seedClaudeResources(baseDir: string, names: readonly string[]): void {
  for (const name of names) {
    if (name.endsWith("-cmd")) {
      seedClaudeCommand(baseDir, name);
      continue;
    }
    if (name.endsWith("-skill")) {
      seedClaudeSkill(baseDir, name);
      continue;
    }
    if (name.endsWith("-agent")) {
      seedClaudeAgent(baseDir, name);
      continue;
    }
    throw new Error(`Unsupported E2E resource name: ${name}`);
  }
}

function initMarketplaceRepo(marketplaceRepo: string, fixtureRoot: string): void {
  cpSync(fixtureRoot, marketplaceRepo, { recursive: true });
  spawnSync("git", ["init"], { cwd: marketplaceRepo, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: marketplaceRepo, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=e2e@test", "-c", "user.name=e2e", "commit", "-m", "init"],
    { cwd: marketplaceRepo, stdio: "ignore" },
  );
}

export function createE2EIsolation(repoRoot: string): E2EIsolation {
  const root = mkdtempSync(join(tmpdir(), "harnesstap-e2e-"));
  const home = join(root, "home");
  const harnesstapHome = join(home, ".harnesstap");
  const project = join(root, "project");
  const marketplaceRepo = join(root, "marketplace");

  mkdirSync(home, { recursive: true });
  mkdirSync(harnesstapHome, { recursive: true });
  mkdirSync(join(project, ".harnesstap"), { recursive: true });

  seedClaudeResources(home, USER_RESOURCE_NAMES);
  seedClaudeResources(project, PROJECT_RESOURCE_NAMES);

  const fixtureRoot = join(repoRoot, "apps/desktop/e2e/fixtures/marketplace");
  initMarketplaceRepo(marketplaceRepo, fixtureRoot);

  const env = {
    HOME: home,
    HARNESSTAP_HOME: harnesstapHome,
    HARNESSTAP_E2E_PROJECT_PATH: project,
    HARNESSTAP_E2E_MARKETPLACE_REPO: marketplaceRepo,
    HARNESSTAP_TELEMETRY: "0",
  };

  const paths: E2EIsolationPaths = { project, marketplaceRepo, home };
  writeFileSync(E2E_ISOLATION_STATE_PATH, `${JSON.stringify(paths)}\n`, "utf-8");

  return {
    root,
    home,
    harnesstapHome,
    project,
    marketplaceRepo,
    env,
    cleanup() {
      rmSync(E2E_ISOLATION_STATE_PATH, { force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Paths for specs. WDIO workers do not keep custom `browser` fields from `onPrepare`. */
export function loadE2EIsolationPaths(): E2EIsolationPaths {
  const project = process.env.HARNESSTAP_E2E_PROJECT_PATH;
  const marketplaceRepo = process.env.HARNESSTAP_E2E_MARKETPLACE_REPO;
  const home = process.env.HOME;
  if (project && marketplaceRepo && home) {
    return { project, marketplaceRepo, home };
  }
  if (existsSync(E2E_ISOLATION_STATE_PATH)) {
    const parsed = JSON.parse(readFileSync(E2E_ISOLATION_STATE_PATH, "utf-8")) as E2EIsolationPaths;
    if (parsed.project && parsed.marketplaceRepo) {
      return {
        ...parsed,
        home: parsed.home ?? process.env.HOME ?? "",
      };
    }
  }
  throw new Error("E2E isolation paths were not published by onPrepare");
}
