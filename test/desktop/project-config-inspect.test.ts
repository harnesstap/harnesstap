import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const inspectSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/ProjectConfigInspect.tsx",
  ),
  "utf8",
);
const sectionsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/SettingsParitySections.tsx",
  ),
  "utf8",
);
const settingsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SettingsDrawer.tsx",
  ),
  "utf8",
);
const pickerSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ProjectPicker.tsx",
  ),
  "utf8",
);
const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function sliceBetween(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("settings project config picker", () => {
  test("Project tab always shows a project directory picker", () => {
    expect(inspectSource).toContain("ProjectPicker");
    expect(inspectSource).toContain('testId="project-config-path"');
    expect(inspectSource).toContain("onSelectProject");
    expect(inspectSource).toContain("onBrowseProject");
    expect(inspectSource).toContain("Select a project to inspect its config.");
  });

  test("picker uses a distinct test id from the header project control", () => {
    expect(pickerSource).toContain("testId = \"project-path\"");
    expect(pickerSource).toContain("data-testid={testId}");
    expect(inspectSource).not.toContain('data-testid="project-path"');
  });

  test("Escape closes the open picker without dismissing the settings panel", () => {
    expect(pickerSource).toContain('event.stopImmediatePropagation()');
    expect(pickerSource).toContain("addEventListener(\"keydown\", onKeyDown, true)");
  });

  test("settings inspect uses the selected project even outside Project workspace", () => {
    const settingsCall = sliceBetween(
      appSource,
      "<SettingsDrawer",
      "<CloudAccountDrawer",
    );
    expect(settingsCall).toContain(
      'projectPath={view === "project" ? projectPath : null}',
    );
    expect(settingsCall).toContain("inspectProjectPath={projectPath || null}");
    expect(settingsCall).toContain("onSelectProject={selectProject}");
    expect(settingsCall).toContain("onBrowseProject={() => void browseProject()}");
  });

  test("Settings wires inspect path and picker callbacks into the Project tab", () => {
    expect(settingsSource).toContain("inspectProjectPath");
    expect(settingsSource).toContain("onSelectProject");
    expect(settingsSource).toContain("onBrowseProject");
    expect(sectionsSource).toContain("projectPath={props.inspectProjectPath}");
    expect(sectionsSource).toContain("onSelectProject={props.onSelectProject}");
    expect(sectionsSource).toContain("onBrowseProject={props.onBrowseProject}");
  });

  test("DESIGN.md locks a Project tab directory picker", () => {
    expect(designSource).toContain("project directory picker");
    expect(designSource).toContain("raw `apm.yml` editor");
  });
});

describe("settings project config inspect surface", () => {
  test("DESIGN.md locks Project tab raw apm.yml edit plus Open config", () => {
    expect(designSource).toContain("raw `apm.yml` editor");
    expect(designSource).toContain("Open config");
    expect(designSource).toContain("profile definition list");
    expect(designSource).not.toContain("Project tab is inspect-only");
  });

  test("edits raw apm.yml in-app and keeps Open config", () => {
    expect(inspectSource).toContain("apm.yml");
    expect(inspectSource).toContain("library-field-editor-content");
    expect(inspectSource).toContain("putProjectConfigRaw");
    expect(inspectSource).toContain("fetchProjectConfigRaw");
    expect(inspectSource).toContain("Open config");
    expect(inspectSource).toContain("project-config-save");
    expect(inspectSource).not.toContain("config.toml");
  });

  test("does not dump config path, root, or zero counts", () => {
    expect(inspectSource).not.toContain('<dd className="mono">{config.config_path}</dd>');
    expect(inspectSource).not.toContain('<dd className="mono">{config.root_path}</dd>');
    expect(inspectSource).not.toContain("environment_count");
    expect(inspectSource).not.toContain("plugin_count");
    expect(inspectSource).not.toContain("<dt>Config</dt>");
    expect(inspectSource).not.toContain("<dt>Root</dt>");
    expect(inspectSource).not.toContain("<dt>Default profile</dt>");
    expect(inspectSource).not.toContain("<dt>Environments</dt>");
    expect(inspectSource).not.toContain("<dt>Inline plugins</dt>");
  });

  test("does not celebrate valid config", () => {
    expect(inspectSource).not.toContain("Config is valid.");
  });

  test("opens config via labeled button and openResourcePath", () => {
    expect(inspectSource).toContain("Open config");
    expect(inspectSource).toContain('className="btn"');
    expect(inspectSource).toContain("openResourcePath");
    expect(inspectSource).toContain("config_path");
    expect(inspectSource).toContain("rawPath");
  });

  test("marks default profile with a badge not an asterisk", () => {
    expect(inspectSource).toContain('className="badge"');
    expect(inspectSource).toContain(">default<");
    expect(inspectSource).not.toContain('" *"');
  });

  test("lists profiles as definition lists not a table", () => {
    expect(inspectSource).toContain("harness-block");
    expect(inspectSource).toContain("resource-detail-kv");
    expect(inspectSource).not.toContain("<table");
  });
});
