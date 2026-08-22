import { MarketplaceSettingsSection } from "./MarketplaceSettingsSection";
import { ProjectConfigInspect } from "./ProjectConfigInspect";
import { PublishCatalogsSettings } from "./PublishCatalogsSettings";
import { ResolveOrderSettings } from "./ResolveOrderSettings";

export type SettingsTab =
  | "harnesses"
  | "marketplaces"
  | "publish"
  | "project"
  | "advanced";

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "harnesses", label: "Harnesses" },
  { id: "marketplaces", label: "Marketplaces" },
  { id: "publish", label: "Publish catalogs" },
  { id: "project", label: "Project" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsParitySections(props: {
  tab: Exclude<SettingsTab, "harnesses">;
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  inspectProjectPath: string | null;
  disabled?: boolean;
  onSaved?: () => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
}) {
  switch (props.tab) {
    case "marketplaces":
      return (
        <MarketplaceSettingsSection
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
        />
      );
    case "publish":
      return (
        <PublishCatalogsSettings
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
        />
      );
    case "project":
      return (
        <ProjectConfigInspect
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          projectPath={props.inspectProjectPath}
          disabled={props.disabled}
          onSelectProject={props.onSelectProject}
          onBrowseProject={props.onBrowseProject}
        />
      );
    case "advanced":
      return (
        <ResolveOrderSettings
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
          onSaved={props.onSaved}
        />
      );
    default: {
      const neverTab: never = props.tab;
      return neverTab;
    }
  }
}
