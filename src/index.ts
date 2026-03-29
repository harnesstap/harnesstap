import { Command } from "commander";
import { getDb, closeDb, getDbPath } from "./db/connection.js";
import { initializeSchema } from "./db/schema.js";
import { log } from "./utils/logger.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "./services/git.js";
import { scanAndPersist, scanProject, detectPlatforms } from "./services/scanner.js";
import { applyToProject, generateFiles, writeFiles } from "./services/applier.js";
import { exportToFile, importFromFile } from "./services/exporter.js";
import { listResources, getResource, deleteResource } from "./models/resource.js";
import {
  createPreset,
  getPreset,
  listPresets,
  deletePreset,
  addResourceToPreset,
  removeResourceFromPreset,
  getPresetResources,
} from "./models/preset.js";
import {
  upsertProject,
  getProject,
  getProjectByOrigin,
  applyPresetToProject,
  getProjectPresets,
} from "./models/project.js";
import { createSnapshot, listSnapshots, getSnapshot } from "./models/snapshot.js";
import { getAllPlatforms } from "./platforms/registry.js";
import { seedBuiltInTemplates } from "./services/templates.js";
import { resolve } from "node:path";
import type { ResourceType, SnapshotState } from "./types.js";
import { RESOURCE_TYPES } from "./types.js";

const program = new Command();

program
  .name("skillset")
  .description(
    "Unified AI coding assistant configuration manager — manage, align, and share presets across 40+ coding CLIs",
  )
  .version("0.1.0");

// ── init ────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize the skillset database and config directory")
  .action(() => {
    const db = getDb();
    initializeSchema(db);
    const seeded = seedBuiltInTemplates();
    log.success(`Database initialized at ${getDbPath()}`);
    if (seeded > 0) log.info(`Seeded ${seeded} built-in template(s)`);
  });

// ── scan ────────────────────────────────────────────────────────────────

program
  .command("scan")
  .argument("[path]", "Project directory to scan", ".")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .option("--dry-run", "Show what would be imported without writing to DB")
  .description("Scan a project directory and import configurations into the database")
  .action(async (path: string, opts: { platform?: string; dryRun?: boolean }) => {
    const db = getDb();
    initializeSchema(db);
    const projectRoot = resolve(path);

    // Detect platforms
    const detected = detectPlatforms(projectRoot);
    if (detected.length === 0) {
      log.warn("No coding CLI configurations detected in this directory.");
      return;
    }
    log.info(`Detected platforms: ${detected.join(", ")}`);

    if (opts.dryRun) {
      log.dim("(dry run — not persisting to database)");
      const results = await scanProject(projectRoot, opts.platform);
      let count = 0;
      for (const result of results) {
        log.info(`Platform: ${result.platformId}`);
        for (const r of result.resources) {
          count++;
          log.dim(`  ${r.type.padEnd(14)} ${r.name}`);
        }
      }
      log.success(`Would import ${count} resources`);
      return;
    }

    // Scan and persist
    const resources = await scanAndPersist(projectRoot, opts.platform);
    log.success(`Imported ${resources.length} resources`);

    for (const r of resources) {
      log.dim(`  ${r.type.padEnd(14)} ${r.name}`);
    }

    // Register project
    const gitOrigin = getGitOrigin(projectRoot);
    if (gitOrigin) {
      const normalized = normalizeGitUrl(gitOrigin);
      const name = projectNameFromUrl(gitOrigin);
      upsertProject({ git_origin: normalized, name, local_path: projectRoot });
      log.info(`Project registered: ${name} (${normalized})`);
    }
  });

// ── preset ──────────────────────────────────────────────────────────────

const presetCmd = program.command("preset").description("Manage presets");

presetCmd
  .command("create")
  .argument("<name>", "Preset name")
  .option("-d, --description <text>", "Preset description")
  .option("-t, --template", "Mark as a reusable template")
  .option("--tags <tags>", "Comma-separated tags")
  .action(
    (
      name: string,
      opts: { description?: string; template?: boolean; tags?: string },
    ) => {
      const db = getDb();
      initializeSchema(db);
      const tags = opts.tags?.split(",").map((t) => t.trim()) ?? [];
      const preset = createPreset({
        name,
        description: opts.description,
        tags,
        is_template: opts.template,
      });
      log.success(`Preset created: ${preset.name} (${preset.id})`);
    },
  );

presetCmd
  .command("list")
  .alias("ls")
  .option("--templates", "Show only templates")
  .action((opts: { templates?: boolean }) => {
    const db = getDb();
    initializeSchema(db);
    const presets = listPresets({ templates_only: opts.templates });
    if (presets.length === 0) {
      log.dim("No presets found.");
      return;
    }
    for (const p of presets) {
      const tmpl = p.is_template ? " [template]" : "";
      log.info(`${p.name}${tmpl} — ${p.description || "(no description)"}`);
    }
  });

presetCmd
  .command("show")
  .argument("<name>", "Preset name or ID")
  .action((name: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(name);
    if (!preset) {
      log.error(`Preset not found: ${name}`);
      return;
    }
    log.info(`${preset.name} — ${preset.description}`);
    const resources = getPresetResources(preset.id);
    for (const r of resources) {
      log.dim(`  ${r.type.padEnd(14)} ${r.name} (${r.id.slice(0, 8)}…)`);
    }
  });

presetCmd
  .command("add")
  .argument("<preset>", "Preset name or ID")
  .argument("<resource-id>", "Resource ID to add")
  .action((presetName: string, resourceId: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    addResourceToPreset(preset.id, resourceId);
    log.success(`Added resource ${resourceId} to preset ${preset.name}`);
  });

presetCmd
  .command("remove")
  .argument("<preset>", "Preset name or ID")
  .argument("<resource-id>", "Resource ID to remove")
  .action((presetName: string, resourceId: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    removeResourceFromPreset(preset.id, resourceId);
    log.success(`Removed resource ${resourceId} from preset ${preset.name}`);
  });

presetCmd
  .command("delete")
  .argument("<name>", "Preset name or ID")
  .action((name: string) => {
    const db = getDb();
    initializeSchema(db);
    if (deletePreset(name)) {
      log.success(`Preset deleted: ${name}`);
    } else {
      log.error(`Preset not found: ${name}`);
    }
  });

// ── resource ────────────────────────────────────────────────────────────

const resourceCmd = program.command("resource").description("Manage resources");

resourceCmd
  .command("list")
  .alias("ls")
  .option("-t, --type <type>", "Filter by resource type")
  .option("-s, --search <query>", "Search by name or description")
  .action((opts: { type?: string; search?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const type = opts.type as ResourceType | undefined;
    if (type && !RESOURCE_TYPES.includes(type)) {
      log.error(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
      return;
    }
    const resources = listResources({ type, search: opts.search });
    if (resources.length === 0) {
      log.dim("No resources found.");
      return;
    }
    for (const r of resources) {
      log.info(
        `${r.id.slice(0, 8)}… ${r.type.padEnd(14)} ${r.name}`,
      );
    }
  });

resourceCmd
  .command("show")
  .argument("<id>", "Resource ID")
  .action((id: string) => {
    const db = getDb();
    initializeSchema(db);
    const r = getResource(id);
    if (!r) {
      log.error(`Resource not found: ${id}`);
      return;
    }
    console.log(`Type:        ${r.type}`);
    console.log(`Name:        ${r.name}`);
    console.log(`Description: ${r.description}`);
    console.log(`Source:      ${r.source}`);
    console.log(`Created:     ${r.created_at}`);
    console.log(`Metadata:    ${JSON.stringify(r.metadata, null, 2)}`);
    console.log(`\n--- Content ---\n${r.content}`);
  });

resourceCmd
  .command("delete")
  .argument("<id>", "Resource ID")
  .action((id: string) => {
    const db = getDb();
    initializeSchema(db);
    if (deleteResource(id)) {
      log.success(`Deleted resource: ${id}`);
    } else {
      log.error(`Resource not found: ${id}`);
    }
  });

// ── apply ───────────────────────────────────────────────────────────────

program
  .command("apply")
  .argument("<preset>", "Preset name or ID")
  .option("--project <path>", "Project directory", ".")
  .option("--platform <slugs>", "Comma-separated platform slugs")
  .option("--dry-run", "Show what would be written")
  .description("Apply a preset to a project, serializing for each platform")
  .action(
    async (
      presetName: string,
      opts: { project: string; platform?: string; dryRun?: boolean },
    ) => {
      const db = getDb();
      initializeSchema(db);

      const preset = getPreset(presetName);
      if (!preset) {
        log.error(`Preset not found: ${presetName}`);
        return;
      }

      const projectRoot = resolve(opts.project);
      const platforms = opts.platform
        ? opts.platform.split(",")
        : detectPlatforms(projectRoot);

      if (platforms.length === 0) {
        log.warn("No platforms detected. Use --platform to specify.");
        return;
      }

      const resources = getPresetResources(preset.id);
      const generated = await generateFiles(resources, platforms, projectRoot);

      // Create snapshot before applying
      const gitOrigin = getGitOrigin(projectRoot);
      if (gitOrigin) {
        const normalized = normalizeGitUrl(gitOrigin);
        const project = upsertProject({
          git_origin: normalized,
          name: projectNameFromUrl(gitOrigin),
          local_path: projectRoot,
        });

        const snapshotState: SnapshotState = {
          presets: [preset],
          resources,
          platform_files: Object.fromEntries(
            generated.map((result) => [
              result.platformId,
              Object.fromEntries(result.files.map((f) => [f.path, f.content])),
            ]),
          ),
        };
        createSnapshot({
          project_id: project.id,
          label: `Before applying: ${preset.name}`,
          state: snapshotState,
        });

        // Record the preset → project association
        applyPresetToProject({
          project_id: project.id,
          preset_id: preset.id,
          platforms,
        });
      }

      if (opts.dryRun) {
        log.dim("(dry run — showing files that would be written)");
        for (const r of generated) {
          log.info(`Platform: ${r.platformId}`);
          for (const f of r.files) {
            log.dim(`  ${f.path}`);
          }
        }
        return;
      }
      for (const r of generated) {
        writeFiles(r.files, projectRoot);
        log.success(`${r.platformId}: wrote ${r.files.length} file(s)`);
        for (const f of r.files) {
          log.dim(`  ${f.path}`);
        }
      }
    },
  );

// ── history / revert ────────────────────────────────────────────────────

program
  .command("history")
  .option("--project <path>", "Project directory", ".")
  .description("List configuration snapshots for a project")
  .action((opts: { project: string }) => {
    const db = getDb();
    initializeSchema(db);
    const projectRoot = resolve(opts.project);
    const gitOrigin = getGitOrigin(projectRoot);
    if (!gitOrigin) {
      log.error("Not a git repository.");
      return;
    }
    const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
    if (!project) {
      log.warn("No project record found. Run `skillset scan` first.");
      return;
    }
    const snapshots = listSnapshots(project.id);
    if (snapshots.length === 0) {
      log.dim("No snapshots found.");
      return;
    }
    for (const s of snapshots) {
      log.info(`${s.id.slice(0, 10)}… ${s.created_at} — ${s.label}`);
    }
  });

program
  .command("revert")
  .argument("[snapshot-id]", "Snapshot ID to revert to")
  .description("Revert a project to a previous configuration snapshot")
  .action((snapshotId?: string) => {
    const db = getDb();
    initializeSchema(db);
    if (!snapshotId) {
      log.error("Please provide a snapshot ID. Use `skillset history` to list them.");
      return;
    }
    const snapshot = getSnapshot(snapshotId);
    if (!snapshot) {
      log.error(`Snapshot not found: ${snapshotId}`);
      return;
    }
    const project = getProject(snapshot.project_id);
    if (!project) {
      log.error("Snapshot project not found.");
      return;
    }
    const files = Object.entries(snapshot.state.platform_files).flatMap(
      ([, platformFiles]) =>
        Object.entries(platformFiles).map(([path, content]) => ({ path, content })),
    );
    writeFiles(files, project.local_path);
    log.info(`Reverting to snapshot: ${snapshot.label} (${snapshot.created_at})`);
    log.success(`Restored ${files.length} file(s) to ${project.local_path}`);
  });

// ── export / import ─────────────────────────────────────────────────────

program
  .command("export")
  .argument("<preset>", "Preset name or ID")
  .option("-f, --file <path>", "Output file path")
  .description("Export a preset as a shareable JSON bundle")
  .action((presetName: string, opts: { file?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const filePath = opts.file ?? `${presetName}.skillset.json`;
    exportToFile(presetName, filePath);
    log.success(`Exported to ${filePath}`);
  });

program
  .command("import")
  .argument("<file>", "JSON bundle file to import")
  .description("Import a preset from a JSON bundle file")
  .action((file: string) => {
    const db = getDb();
    initializeSchema(db);
    const { preset, resources } = importFromFile(file);
    log.success(
      `Imported preset "${preset.name}" with ${resources.length} resources`,
    );
  });

// ── platforms ───────────────────────────────────────────────────────────

program
  .command("platforms")
  .description("List all supported platforms and their capabilities")
  .action(() => {
    const platforms = getAllPlatforms();
    for (const p of platforms) {
      const features = [...p.supports].join(", ");
      log.info(`${p.id.padEnd(20)} ${p.name.padEnd(20)} [${features}]`);
    }
  });

// ── status ──────────────────────────────────────────────────────────────

program
  .command("status")
  .argument("[path]", "Project directory", ".")
  .description("Show current project status")
  .action((path: string) => {
    const db = getDb();
    initializeSchema(db);
    const projectRoot = resolve(path);
    const gitOrigin = getGitOrigin(projectRoot);
    const detected = detectPlatforms(projectRoot);

    console.log(`Project root:  ${projectRoot}`);
    console.log(`Git origin:    ${gitOrigin ?? "(none)"}`);
    console.log(`Platforms:     ${detected.join(", ") || "(none detected)"}`);

    if (gitOrigin) {
      const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
      if (project) {
        const presets = getProjectPresets(project.id);
        const snapshots = listSnapshots(project.id);
        console.log(`Applied presets: ${presets.length}`);
        console.log(`Snapshots:       ${snapshots.length}`);
      }
    }
  });

// ── template ────────────────────────────────────────────────────────────

const templateCmd = program
  .command("template")
  .description("Manage preset templates");

templateCmd
  .command("list")
  .alias("ls")
  .action(() => {
    const db = getDb();
    initializeSchema(db);
    seedBuiltInTemplates();
    const templates = listPresets({ templates_only: true });
    if (templates.length === 0) {
      log.dim("No templates found. Import one with `skillset import`.");
      return;
    }
    for (const t of templates) {
      log.info(`${t.name} — ${t.description}`);
    }
  });

templateCmd
  .command("apply")
  .argument("<template-name>", "Template name")
  .option("--project <path>", "Project directory", ".")
  .option("--platform <slugs>", "Comma-separated platform slugs")
  .description("Apply a template to a project")
  .action(
    async (
      templateName: string,
      opts: { project: string; platform?: string },
    ) => {
      const db = getDb();
      initializeSchema(db);
      seedBuiltInTemplates();
      const preset = getPreset(templateName);
      if (!preset || !preset.is_template) {
        log.error(`Template not found: ${templateName}`);
        return;
      }
      const projectRoot = resolve(opts.project);
      const platforms = opts.platform
        ? opts.platform.split(",")
        : detectPlatforms(projectRoot);
      if (platforms.length === 0) {
        log.warn("No platforms detected. Use --platform to specify.");
        return;
      }
      const resources = getPresetResources(preset.id);
      const results = await applyToProject(resources, platforms, projectRoot);
      for (const r of results) {
        log.success(`${r.platformId}: wrote ${r.files.length} file(s)`);
        for (const f of r.files) {
          log.dim(`  ${f.path}`);
        }
      }
    },
  );

// ── cleanup ─────────────────────────────────────────────────────────────

process.on("exit", () => closeDb());

program.parse();
