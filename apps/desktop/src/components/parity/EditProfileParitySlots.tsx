import { DefaultEnvironmentField } from "./DefaultEnvironmentField";
import { ProfileCatalogBindings } from "./ProfileCatalogBindings";
import { ProfileDeleteControls } from "./ProfileDeleteControls";
import { PublishProfileDrawer } from "./PublishProfileDrawer";

export function EditProfileParitySlots(props: {
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onDeleted: () => void;
  onMutated?: () => void;
}) {
  return (
    <div className="edit-profile-parity-slots">
      <DefaultEnvironmentField
        profileName={props.profileName}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
        onMutated={props.onMutated}
      />
      <ProfileCatalogBindings
        profileName={props.profileName}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
      />
      <PublishProfileDrawer />
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
