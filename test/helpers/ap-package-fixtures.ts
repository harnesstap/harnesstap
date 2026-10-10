import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AP_PACKAGE_SCHEMA } from "../../src/services/agent-plugins/files.ts";

const fixturesDir = join(import.meta.dirname, "../../schemas/fixtures");

export function readApFixture(filename: string): string {
  return readFileSync(join(fixturesDir, filename), "utf8");
}

/** Minimal Agent Plugins envelope for catalog/download mocks. */
export function makeApEnvelope(input?: {
  name?: string;
  version?: string;
  description?: string;
  skillName?: string;
  skillBody?: string;
  /** When true, omit plugin.json `$schema` (Cloud catalog bug / G2 fixture). */
  omitSchema?: boolean;
  dependencies?: Array<{ name: string; constraint: string; source?: string }>;
}): string {
  const name = input?.name ?? "remote-team";
  const version = input?.version ?? "1.0.0";
  const description = input?.description ?? "from cloud";
  const skillName = input?.skillName ?? "r";
  const skillBody = input?.skillBody ?? "#x";
  const extension: Record<string, unknown> = {
    schema: "urn:harnesstap:ap-extension:v1",
    sourceName: name,
  };
  if (input?.dependencies && input.dependencies.length > 0) {
    extension.dependencies = input.dependencies.map((dependency) => ({
      name: dependency.name,
      constraint: dependency.constraint,
      source: dependency.source ?? "local",
    }));
  }
  const manifest: Record<string, unknown> = {
    name,
    version,
    description,
    keywords: [] as string[],
    extensions: {
      "com.harnesstap": extension,
    },
  };
  if (!input?.omitSchema) {
    manifest.$schema = "https://agentplugins.org/schemas/v1/plugin.json";
  }
  return `${JSON.stringify(
    {
      schema: AP_PACKAGE_SCHEMA,
      files: {
        "plugin.json": {
          encoding: "utf8",
          content: JSON.stringify(manifest),
        },
        [`skills/${skillName}/SKILL.md`]: {
          encoding: "utf8",
          content: `---\nname: ${skillName}\ndescription: ${description}\n---\n${skillBody}\n`,
        },
      },
    },
    null,
    2,
  )}\n`;
}
