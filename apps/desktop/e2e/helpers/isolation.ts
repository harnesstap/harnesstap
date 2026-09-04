import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    HARNESSTAP_TELEMETRY: "0",
  };

  return {
    root,
    home,
    harnesstapHome,
    project,
    marketplaceRepo,
    env,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
