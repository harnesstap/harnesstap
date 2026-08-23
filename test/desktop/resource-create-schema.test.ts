import { describe, expect, test } from "bun:test";
import {
  buildCreateRequestBody,
  CREATE_RESOURCE_TYPES,
  fieldError,
  getResourceCreateSchema,
  initialValuesFor,
  RESOURCE_CREATE_SCHEMAS,
  validateValues,
  valuesAreDirty,
  visibleFields,
} from "../../apps/desktop/src/lib/resource-create-schema.ts";

describe("resource create schemas", () => {
  test("every creatable type has a schema", () => {
    expect(CREATE_RESOURCE_TYPES).toHaveLength(11);
    for (const type of CREATE_RESOURCE_TYPES) {
      const schema = getResourceCreateSchema(type);
      expect(schema.title.length).toBeGreaterThan(0);
      expect(schema.description.length).toBeGreaterThan(0);
      const keys = schema.fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(Object.keys(RESOURCE_CREATE_SCHEMAS).sort()).toEqual(
      [...CREATE_RESOURCE_TYPES].sort(),
    );
  });

  test("common fields are present and correctly required", () => {
    for (const type of CREATE_RESOURCE_TYPES) {
      const schema = getResourceCreateSchema(type);
      const name = schema.fields.find((field) => field.key === "name");
      expect(name?.required).toBe(true);
      const description = schema.fields.find((field) => field.key === "description");
      expect(description?.required).toBe(false);
    }
  });

  test("required fields match the server contract", () => {
    const contentTypes = ["instruction", "skill", "rule", "agent", "command"] as const;
    for (const type of contentTypes) {
      expect(
        getResourceCreateSchema(type).fields.some(
          (field) => field.key === "content" && field.required,
        ),
      ).toBe(true);
    }
    expect(
      getResourceCreateSchema("env_var").fields.filter((field) => field.required).map(
        (field) => field.key,
      ).sort(),
    ).toEqual(["key", "name", "value"].sort());
    expect(
      getResourceCreateSchema("permission").fields.filter((field) => field.required).map(
        (field) => field.key,
      ).sort(),
    ).toEqual(["action", "name", "pattern"].sort());
    expect(getResourceCreateSchema("plugin").supportsComposition).toBe(true);
  });
});

describe("form value helpers", () => {
  test("initial values: selects take their first option, checkboxes false", () => {
    const mcp = initialValuesFor(getResourceCreateSchema("mcp_server"));
    expect(mcp.transport).toBe("stdio");
    expect(mcp.command).toBe("");
    const rule = initialValuesFor(getResourceCreateSchema("rule"));
    expect(rule.always_apply).toBe(false);
  });

  test("visibleFields honors showWhen", () => {
    const schema = getResourceCreateSchema("mcp_server");
    const stdio = visibleFields(schema, { ...initialValuesFor(schema) });
    expect(stdio.map((field) => field.key)).toContain("command");
    expect(stdio.map((field) => field.key)).not.toContain("url");

    const http = visibleFields(schema, {
      ...initialValuesFor(schema),
      transport: "http",
    });
    expect(http.map((field) => field.key)).toContain("url");
    expect(http.map((field) => field.key)).not.toContain("command");
  });

  test("validateValues flags only visible required fields", () => {
    const schema = getResourceCreateSchema("permission");
    const errors = validateValues(schema, initialValuesFor(schema));
    expect(errors.name).toBe("Name is required");
    expect(errors.pattern).toBe("Pattern is required");
    expect(errors.action).toBeUndefined();

    const fixed = validateValues(schema, {
      ...initialValuesFor(schema),
      name: "guard",
      pattern: "Bash(rm *)",
    });
    expect(Object.keys(fixed)).toHaveLength(0);
  });

  test("fieldError messages", () => {
    const spec = getResourceCreateSchema("env_var").fields.find(
      (field) => field.key === "key",
    );
    if (!spec) {
      throw new Error("env_var key field missing");
    }
    expect(fieldError(spec, "")).toBe("Key is required");
    expect(fieldError(spec, "  ")).toBe("Key is required");
    expect(fieldError(spec, "FOO")).toBeNull();
  });

  test("valuesAreDirty compares against initial snapshot", () => {
    const schema = getResourceCreateSchema("instruction");
    const initial = initialValuesFor(schema);
    expect(valuesAreDirty(initial, initial)).toBe(false);
    expect(valuesAreDirty({ ...initial, name: "x" }, initial)).toBe(true);
    expect(valuesAreDirty({ ...initial, name: " " }, initial)).toBe(true);
  });
});

describe("buildCreateRequestBody", () => {
  test("maps common fields and trims", () => {
    const body = buildCreateRequestBody(getResourceCreateSchema("skill"), {
      ...initialValuesFor(getResourceCreateSchema("skill")),
      name: " ship ",
      description: "  ",
      content: " body ",
    });
    expect(body).toEqual({ type: "skill", name: "ship", content: "body" });
  });

  test("rule csv globs become arrays (empty stays [])", () => {
    const schema = getResourceCreateSchema("rule");
    const body = buildCreateRequestBody(schema, {
      ...initialValuesFor(schema),
      name: "fmt",
      content: "format",
      globs: " src/**/*.ts , docs/**/*.md ",
      always_apply: true,
    });
    expect(body.metadata).toEqual({
      globs: ["src/**/*.ts", "docs/**/*.md"],
      always_apply: true,
    });

    const noGlobs = buildCreateRequestBody(schema, {
      ...initialValuesFor(schema),
      name: "fmt2",
      content: "format",
    });
    expect(noGlobs.metadata).toEqual({ globs: [], always_apply: false });
  });

  test("mcp_server respects transport branch", () => {
    const schema = getResourceCreateSchema("mcp_server");
    const stdio = buildCreateRequestBody(schema, {
      ...initialValuesFor(schema),
      name: "local",
      command: " npx ",
      args: "-y, server",
    });
    expect(stdio.metadata).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
    });

    const http = buildCreateRequestBody(schema, {
      ...initialValuesFor(schema),
      transport: "http",
      name: "remote",
      url: "https://example.com/mcp",
    });
    expect(http.metadata).toEqual({ transport: "http", url: "https://example.com/mcp" });
    expect(http.content).toBeUndefined();
  });

  test("number coercion for hook timeout", () => {
    const schema = getResourceCreateSchema("hook");
    const body = buildCreateRequestBody(schema, {
      ...initialValuesFor(schema),
      name: "h",
      event: "post_tool_use",
      script: "./x.sh",
      timeout: "30",
    });
    expect(body.metadata).toMatchObject({ timeout: 30 });
  });
});
