import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { packProject, PackError, sha256Hex } from "../../src/services/apm-pack.ts";
import {
  BundleIntegrityError,
  loadVerifiedPackageFiles,
  verifyPackedBundleBytes,
} from "../../src/services/apm-bundle.ts";
import { parseApPackageFiles } from "../../src/services/agent-plugins/import.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apm-pack-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function writeManifest(extra = ""): void {
  writeTextFile(
    join(ctx.projectDir, "apm.yml"),
    `name: demo-pack
version: "1.2.0"
description: Packed demo
author: Jane Doe
license: MIT
homepage: https://example.com
repository: https://github.com/acme/demo-pack
keywords:
  - demo
${extra}`,
  );
}

describe("packProject", () => {
  it("synthesizes plugin.json and packs .apm primitives", () => {
    writeManifest();
    writeTextFile(
      join(ctx.projectDir, ".apm", "skills", "ship", "SKILL.md"),
      "---\nname: ship\ndescription: Ship it\n---\n# Ship\n",
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "agents", "review.agent.md"),
      "---\nname: review\n---\nReview the diff.\n",
    );
    writeTextFile(join(ctx.projectDir, ".apm", "commands", "draft.md"), "# Draft\n");
    writeTextFile(
      join(ctx.projectDir, ".apm", "hooks", "hooks.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ command: "echo" }] } }),
    );

    const result = packProject({ projectRoot: ctx.projectDir });
    expect(result.name).toBe("demo-pack");
    expect(result.version).toBe("1.2.0");
    expect(existsSync(join(ctx.projectDir, "build", "demo-pack", "plugin.json"))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(result.outputPath, "plugin.json"), "utf8"),
    ) as {
      name: string;
      author: { name: string };
      license: string;
      keywords: string[];
    };
    expect(manifest.name).toBe("demo-pack");
    expect(manifest.author).toEqual({ name: "Jane Doe" });
    expect(manifest.license).toBe("MIT");
    expect(manifest.keywords).toEqual(["demo"]);

    expect(existsSync(join(result.outputPath, "skills", "ship", "SKILL.md"))).toBe(true);
    expect(existsSync(join(result.outputPath, "agents", "review.agent.md"))).toBe(true);
    expect(existsSync(join(result.outputPath, "commands", "draft.md"))).toBe(true);
    expect(existsSync(join(result.outputPath, "hooks", "hooks.json"))).toBe(true);

    const lock = parseYaml(
      readFileSync(join(result.outputPath, "apm.lock.yaml"), "utf8"),
    ) as { pack: { format: string; bundle_files: Record<string, string> } };
    expect(lock.pack.format).toBe("plugin");
    expect(lock.pack.bundle_files["plugin.json"]).toBe(
      sha256Hex(readFileSync(join(result.outputPath, "plugin.json"))),
    );
    expect(lock.pack.bundle_files["apm.lock.yaml"]).toBeUndefined();

    const parsed = parseApPackageFiles(loadVerifiedPackageFiles(result.outputPath));
    expect(parsed.resources.map((resource) => `${resource.type}:${resource.name}`).sort()).toEqual([
      "agent:review",
      "command:draft",
      "hook:PreToolUse-1",
      "skill:ship",
    ]);
  });

  it("skips root primitive dirs when .apm/ is present", () => {
    writeManifest();
    writeTextFile(join(ctx.projectDir, ".apm", "skills", "kept", "SKILL.md"), "# Kept\n");
    writeTextFile(join(ctx.projectDir, "skills", "skipped", "SKILL.md"), "# Skipped\n");

    const result = packProject({ projectRoot: ctx.projectDir });
    expect(result.warnings.some((warning) => warning.includes("Skipping root-level skills/"))).toBe(
      true,
    );
    expect(existsSync(join(result.outputPath, "skills", "kept", "SKILL.md"))).toBe(true);
    expect(existsSync(join(result.outputPath, "skills", "skipped", "SKILL.md"))).toBe(false);
  });

  it("fails on critical hidden Unicode", () => {
    writeManifest();
    writeTextFile(
      join(ctx.projectDir, "skills", "evil", "SKILL.md"),
      `do this\u202Ethen that\n`,
    );
    expect(() => packProject({ projectRoot: ctx.projectDir })).toThrow(PackError);
    expect(() => packProject({ projectRoot: ctx.projectDir })).toThrow(/U\+202E/);
  });

  it("rejects symlinks in pack sources", () => {
    writeManifest();
    mkdirSync(join(ctx.projectDir, "skills", "ship"), { recursive: true });
    writeTextFile(join(ctx.projectDir, "skills", "ship", "SKILL.md"), "# Ship\n");
    symlinkSync(
      join(ctx.projectDir, "skills", "ship", "SKILL.md"),
      join(ctx.projectDir, "skills", "ship", "copy.md"),
    );
    expect(() => packProject({ projectRoot: ctx.projectDir })).toThrow(/Symlinks are not allowed/);
  });

  it("writes a zip archive", () => {
    writeManifest();
    writeTextFile(join(ctx.projectDir, "skills", "ship", "SKILL.md"), "# Ship\n");
    const result = packProject({
      projectRoot: ctx.projectDir,
      archive: true,
      outputDir: "dist",
    });
    expect(result.outputPath).toBe(join(ctx.projectDir, "dist", "demo-pack-1.2.0.zip"));
    expect(existsSync(result.outputPath)).toBe(true);
    const parsed = parseApPackageFiles(loadVerifiedPackageFiles(result.outputPath));
    expect(parsed.name).toBe("demo-pack");
    expect(parsed.resources.some((resource) => resource.type === "skill")).toBe(true);
  });

  it("dry-run does not write", () => {
    writeManifest();
    writeTextFile(join(ctx.projectDir, "skills", "ship", "SKILL.md"), "# Ship\n");
    const result = packProject({ projectRoot: ctx.projectDir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(existsSync(result.outputPath)).toBe(false);
  });

  it("packs lockfile-attested dependency files and never copies apm_modules", () => {
    const skillBody = "---\nname: other\ndescription: Dep skill\n---\n# Other\n";
    writeManifest(`dependencies:
  apm:
    - https://github.com/acme/other-skill.git
`);
    writeTextFile(join(ctx.projectDir, ".apm", "skills", "other", "SKILL.md"), skillBody);
    writeTextFile(join(ctx.projectDir, "apm_modules", "other-skill", "SKILL.md"), "# Cache junk\n");
    writeTextFile(
      join(ctx.projectDir, "apm.lock.yaml"),
      `lockfile_version: "1"
dependencies:
  - name: other-skill
    deployed_files:
      - .apm/skills/other/SKILL.md
    deployed_file_hashes:
      .apm/skills/other/SKILL.md: ${sha256Hex(Buffer.from(skillBody, "utf8"))}
`,
    );

    const result = packProject({ projectRoot: ctx.projectDir });
    expect(existsSync(join(result.outputPath, "skills", "other", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(result.outputPath, "skills", "other", "SKILL.md"), "utf8")).toBe(
      skillBody,
    );
    expect(existsSync(join(result.outputPath, "apm_modules"))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("apm_modules"))).toBe(true);
  });

  it("fails when a cache exists but the lockfile has no deployed_files", () => {
    writeManifest(`dependencies:
  apm:
    - https://github.com/acme/other-skill.git
`);
    writeTextFile(join(ctx.projectDir, "apm_modules", "other-skill", "SKILL.md"), "# Cache\n");
    writeTextFile(
      join(ctx.projectDir, "apm.lock.yaml"),
      `lockfile_version: "1"
dependencies:
  - name: other-skill
    version: 1.0.0
`,
    );
    expect(() => packProject({ projectRoot: ctx.projectDir })).toThrow(/no deployed_files/);
  });

  it("fails when an attested dependency file hash no longer matches", () => {
    writeManifest(`dependencies:
  apm:
    - https://github.com/acme/other-skill.git
`);
    writeTextFile(join(ctx.projectDir, ".apm", "skills", "other", "SKILL.md"), "# Edited\n");
    writeTextFile(
      join(ctx.projectDir, "apm.lock.yaml"),
      `lockfile_version: "1"
dependencies:
  - name: other-skill
    deployed_files:
      - .apm/skills/other/SKILL.md
    deployed_file_hashes:
      .apm/skills/other/SKILL.md: ${"a".repeat(64)}
`,
    );
    expect(() => packProject({ projectRoot: ctx.projectDir })).toThrow(
      /does not match the hash recorded/,
    );
  });
});

describe("verifyPackedBundleBytes", () => {
  it("fails closed on extra, missing, and hash mismatch", () => {
    writeManifest();
    writeTextFile(join(ctx.projectDir, "skills", "ship", "SKILL.md"), "# Ship\n");
    const packed = packProject({ projectRoot: ctx.projectDir });
    const pluginJson = readFileSync(join(packed.outputPath, "plugin.json"));
    const skill = readFileSync(join(packed.outputPath, "skills", "ship", "SKILL.md"));
    const lock = readFileSync(join(packed.outputPath, "apm.lock.yaml"));

    expect(() =>
      verifyPackedBundleBytes({
        "plugin.json": pluginJson,
        "skills/ship/SKILL.md": skill,
        "apm.lock.yaml": lock,
        "extra.txt": Buffer.from("nope"),
      }),
    ).toThrow(BundleIntegrityError);

    expect(() =>
      verifyPackedBundleBytes({
        "plugin.json": pluginJson,
        "apm.lock.yaml": lock,
      }),
    ).toThrow(/missing/);

    expect(() =>
      verifyPackedBundleBytes({
        "plugin.json": pluginJson,
        "skills/ship/SKILL.md": Buffer.from("# Tampered\n"),
        "apm.lock.yaml": lock,
      }),
    ).toThrow(/hash mismatch/);
  });

  it("rejects a packed directory that contains a symlink", () => {
    writeManifest();
    writeTextFile(join(ctx.projectDir, "skills", "ship", "SKILL.md"), "# Ship\n");
    const packed = packProject({ projectRoot: ctx.projectDir });
    symlinkSync(
      join(packed.outputPath, "skills", "ship", "SKILL.md"),
      join(packed.outputPath, "skills", "ship", "copy.md"),
    );
    expect(() => loadVerifiedPackageFiles(packed.outputPath)).toThrow(/Symlinks are not allowed/);
  });
});
