import { AP_PACKAGE_SCHEMA } from "../../src/services/agent-plugins/files.ts";

/** Minimal Agent Plugins envelope for catalog/download mocks. */
export function makeApEnvelope(input?: {
  name?: string;
  version?: string;
  description?: string;
  skillName?: string;
  skillBody?: string;
}): string {
  const name = input?.name ?? "remote-team";
  const version = input?.version ?? "1.0.0";
  const description = input?.description ?? "from cloud";
  const skillName = input?.skillName ?? "r";
  const skillBody = input?.skillBody ?? "#x";
  const manifest = {
    $schema: "https://agentplugins.org/schemas/v1/plugin.json",
    name,
    version,
    description,
    keywords: [] as string[],
    extensions: {
      "com.harnesstap": {
        schema: "urn:harnesstap:ap-extension:v1",
        sourceName: name,
      },
    },
  };
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
