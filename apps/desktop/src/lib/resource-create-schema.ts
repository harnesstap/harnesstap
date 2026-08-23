export const CREATE_RESOURCE_TYPES = [
  "plugin",
  "instruction",
  "skill",
  "rule",
  "mcp_server",
  "permission",
  "hook",
  "agent",
  "command",
  "env_var",
  "model_config",
] as const;

export type CreateResourceType = (typeof CREATE_RESOURCE_TYPES)[number];

export type CreateFieldKind =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "checkbox";

export type CreateFieldPath =
  | "name"
  | "description"
  | "content"
  | `metadata.${string}`;

export interface CreateFieldOption {
  value: string;
  label: string;
}

export interface CreateFieldSpec {
  key: string;
  label: string;
  required: boolean;
  kind: CreateFieldKind;
  path: CreateFieldPath;
  placeholder?: string;
  options?: CreateFieldOption[];
  showWhen?: { key: string; equals: string };
  /** Text input whose comma-separated value becomes a string array. */
  csv?: boolean;
}

export interface ResourceCreateSchema {
  type: CreateResourceType;
  title: string;
  description: string;
  fields: CreateFieldSpec[];
  /** Renders the library composition picker (plugin only). */
  supportsComposition?: boolean;
}

const NAME_FIELD: CreateFieldSpec = {
  key: "name",
  label: "Name",
  required: true,
  kind: "text",
  placeholder: "Unique name",
  path: "name",
};

const DESCRIPTION_FIELD: CreateFieldSpec = {
  key: "description",
  label: "Description",
  required: false,
  kind: "textarea",
  placeholder: "Optional description",
  path: "description",
};

function contentField(): CreateFieldSpec {
  return {
    key: "content",
    label: "Content",
    required: true,
    kind: "textarea",
    placeholder: "Markdown content",
    path: "content",
  };
}

export const RESOURCE_CREATE_SCHEMAS: Record<CreateResourceType, ResourceCreateSchema> = {
  plugin: {
    type: "plugin",
    title: "Plugin",
    description: "A versioned context package composed from library resources.",
    supportsComposition: true,
    fields: [NAME_FIELD, DESCRIPTION_FIELD],
  },
  instruction: {
    type: "instruction",
    title: "Instruction",
    description: "Standing guidance injected into the model context.",
    fields: [NAME_FIELD, DESCRIPTION_FIELD, contentField()],
  },
  skill: {
    type: "skill",
    title: "Skill",
    description: "A reusable capability the agent can load on demand.",
    fields: [NAME_FIELD, DESCRIPTION_FIELD, contentField()],
  },
  rule: {
    type: "rule",
    title: "Rule",
    description: "Guidance applied to prompts, optionally scoped by globs.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      contentField(),
      {
        key: "globs",
        label: "Globs",
        required: false,
        kind: "text",
        placeholder: "Comma-separated, e.g. src/**/*.ts",
        path: "metadata.globs",
        csv: true,
      },
      {
        key: "always_apply",
        label: "Always apply",
        required: false,
        kind: "checkbox",
        path: "metadata.always_apply",
      },
    ],
  },
  mcp_server: {
    type: "mcp_server",
    title: "MCP server",
    description: "A Model Context Protocol server registration.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      {
        key: "transport",
        label: "Transport",
        required: true,
        kind: "select",
        options: [
          { value: "stdio", label: "stdio" },
          { value: "http", label: "http" },
        ],
        path: "metadata.transport",
      },
      {
        key: "command",
        label: "Command",
        required: true,
        kind: "text",
        placeholder: "npx -y some-server",
        showWhen: { key: "transport", equals: "stdio" },
        path: "metadata.command",
      },
      {
        key: "args",
        label: "Args",
        required: false,
        kind: "text",
        placeholder: "Comma-separated arguments",
        showWhen: { key: "transport", equals: "stdio" },
        path: "metadata.args",
        csv: true,
      },
      {
        key: "url",
        label: "URL",
        required: true,
        kind: "text",
        placeholder: "https://example.com/mcp",
        showWhen: { key: "transport", equals: "http" },
        path: "metadata.url",
      },
    ],
  },
  permission: {
    type: "permission",
    title: "Permission",
    description: "An allow, deny, or ask rule for tool usage patterns.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      {
        key: "action",
        label: "Action",
        required: true,
        kind: "select",
        options: [
          { value: "allow", label: "Allow" },
          { value: "deny", label: "Deny" },
          { value: "ask", label: "Ask" },
        ],
        path: "metadata.action",
      },
      {
        key: "pattern",
        label: "Pattern",
        required: true,
        kind: "text",
        placeholder: "Bash(npm run *)",
        path: "metadata.pattern",
      },
    ],
  },
  hook: {
    type: "hook",
    title: "Hook",
    description: "A command triggered by a harness lifecycle event.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      {
        key: "event",
        label: "Event",
        required: true,
        kind: "text",
        placeholder: "post_tool_use",
        path: "metadata.event",
      },
      {
        key: "script",
        label: "Script / command",
        required: true,
        kind: "text",
        placeholder: "./scripts/check.sh",
        path: "metadata.script",
      },
      {
        key: "matcher",
        label: "Matcher",
        required: false,
        kind: "text",
        placeholder: "Optional tool matcher",
        path: "metadata.matcher",
      },
      {
        key: "timeout",
        label: "Timeout (seconds)",
        required: false,
        kind: "number",
        placeholder: "30",
        path: "metadata.timeout",
      },
    ],
  },
  agent: {
    type: "agent",
    title: "Agent",
    description: "A subagent definition with optional model settings.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      contentField(),
      {
        key: "model",
        label: "Model",
        required: false,
        kind: "text",
        placeholder: "sonnet",
        path: "metadata.model",
      },
      {
        key: "reasoning_effort",
        label: "Reasoning effort",
        required: false,
        kind: "select",
        options: [
          { value: "", label: "Default" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
        path: "metadata.reasoning_effort",
      },
    ],
  },
  command: {
    type: "command",
    title: "Command",
    description: "A slash-command prompt template.",
    fields: [NAME_FIELD, DESCRIPTION_FIELD, contentField()],
  },
  env_var: {
    type: "env_var",
    title: "Environment variable",
    description: "A single environment variable entry.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      {
        key: "key",
        label: "Key",
        required: true,
        kind: "text",
        placeholder: "MY_VARIABLE",
        path: "metadata.key",
      },
      {
        key: "value",
        label: "Value",
        required: true,
        kind: "text",
        placeholder: "value",
        path: "metadata.value",
      },
    ],
  },
  model_config: {
    type: "model_config",
    title: "Model config",
    description: "A named model and provider configuration.",
    fields: [
      NAME_FIELD,
      DESCRIPTION_FIELD,
      {
        key: "model",
        label: "Model",
        required: true,
        kind: "text",
        placeholder: "gpt-5",
        path: "metadata.model",
      },
      {
        key: "provider",
        label: "Provider",
        required: false,
        kind: "text",
        placeholder: "openai",
        path: "metadata.provider",
      },
    ],
  },
};

export function getResourceCreateSchema(
  type: CreateResourceType,
): ResourceCreateSchema {
  return RESOURCE_CREATE_SCHEMAS[type];
}

export type CreateFormValues = Record<string, string | boolean>;

export function initialValuesFor(schema: ResourceCreateSchema): CreateFormValues {
  const values: CreateFormValues = {};
  for (const spec of schema.fields) {
    if (spec.kind === "checkbox") {
      values[spec.key] = false;
    } else if (spec.kind === "select") {
      values[spec.key] = spec.options?.[0]?.value ?? "";
    } else {
      values[spec.key] = "";
    }
  }
  return values;
}

export function visibleFields(
  schema: ResourceCreateSchema,
  values: CreateFormValues,
): CreateFieldSpec[] {
  return schema.fields.filter((spec) => {
    if (!spec.showWhen) {
      return true;
    }
    return values[spec.showWhen.key] === spec.showWhen.equals;
  });
}

export function fieldError(
  spec: CreateFieldSpec,
  value: string | boolean | undefined,
): string | null {
  if (!spec.required) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? null : `${spec.label} must be checked`;
  }
  return value != null && String(value).trim()
    ? null
    : `${spec.label} is required`;
}

export function validateValues(
  schema: ResourceCreateSchema,
  values: CreateFormValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const spec of visibleFields(schema, values)) {
    const error = fieldError(spec, values[spec.key]);
    if (error) {
      errors[spec.key] = error;
    }
  }
  return errors;
}

export function valuesAreDirty(
  values: CreateFormValues,
  initial: CreateFormValues,
): boolean {
  return Object.keys(initial).some((key) => values[key] !== initial[key]);
}

function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface CreateResourceRequestBody {
  type: CreateResourceType;
  name: string;
  description?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export function buildCreateRequestBody(
  schema: ResourceCreateSchema,
  values: CreateFormValues,
): CreateResourceRequestBody {
  let name = "";
  let description: string | undefined;
  let content: string | undefined;
  const metadata: Record<string, unknown> = {};

  for (const spec of visibleFields(schema, values)) {
    const raw = values[spec.key];
    let coerced: unknown;
    if (spec.kind === "checkbox") {
      coerced = raw === true;
    } else if (typeof raw !== "string") {
      continue;
    } else if (spec.csv) {
      coerced = parseCsv(raw);
    } else if (spec.kind === "number") {
      if (!raw.trim()) {
        continue;
      }
      const parsed = Number(raw.trim());
      if (Number.isNaN(parsed)) {
        continue;
      }
      coerced = parsed;
    } else {
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }
      coerced = trimmed;
    }

    if (spec.path.startsWith("metadata.")) {
      metadata[spec.path.slice("metadata.".length)] = coerced;
    } else if (spec.path === "name") {
      name = String(coerced);
    } else if (spec.path === "description") {
      if (coerced) {
        description = String(coerced);
      }
    } else if (spec.path === "content") {
      content = String(coerced);
    } else {
      const neverPath: never = spec.path;
      void neverPath;
    }
  }

  return {
    type: schema.type,
    ...(name ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
