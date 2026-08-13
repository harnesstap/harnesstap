import { MarketplaceSettingsSection } from "./MarketplaceSettingsSection";
import { ProjectConfigInspect } from "./ProjectConfigInspect";
import { PublishCatalogsSettings } from "./PublishCatalogsSettings";
import { ResolveOrderSettings } from "./ResolveOrderSettings";

export function SettingsParitySections(props: {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  disabled?: boolean;
  onSaved?: () => void;
}) {
  return (
    <>
      <MarketplaceSettingsSection
        open={props.open}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
      />
      <PublishCatalogsSettings
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
      />
      <ProjectConfigInspect
        baseUrl={props.baseUrl}
        token={props.token}
        projectPath={props.projectPath}
        disabled={props.disabled}
      />
      <ResolveOrderSettings
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
        onSaved={props.onSaved}
      />
    </>
  );
}
