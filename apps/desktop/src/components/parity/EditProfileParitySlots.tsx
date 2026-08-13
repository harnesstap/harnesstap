import { DefaultEnvironmentField } from "./DefaultEnvironmentField";
import { ProfileCatalogBindings } from "./ProfileCatalogBindings";
import { ProfileDeleteControls } from "./ProfileDeleteControls";
import { PublishProfileDrawer } from "./PublishProfileDrawer";

export function EditProfileParitySlots(props: {
  profileName: string;
  profileVersion?: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onDeleted: (result?: { plugin_name: string; plugin_deleted: boolean }, message?: string) => void;
  onMutated?: () => void;
  onOpenEnvironments?: () => void;
  onSuccess?: (message: string) => void;
  onRequestSignIn?: () => void;
  onRequestCut?: (name: string, version: string) => void;
}) {
  return (
    <div className="edit-profile-parity-slots">
      <DefaultEnvironmentField
        profileName={props.profileName}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
        onMutated={props.onMutated}
        onOpenEnvironments={props.onOpenEnvironments}
      />
      <ProfileCatalogBindings
        profileName={props.profileName}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
      />
      <PublishProfileDrawer
        profileName={props.profileName}
        profileVersion={props.profileVersion}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
        onSuccess={props.onSuccess}
        onRequestSignIn={props.onRequestSignIn}
        onRequestCut={props.onRequestCut}
      />
      <ProfileDeleteControls
        profileName={props.profileName}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
        onDeleted={props.onDeleted}
      />
    </div>
  );
}
