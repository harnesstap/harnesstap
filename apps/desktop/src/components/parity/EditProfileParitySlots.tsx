import { DefaultEnvironmentField } from "./DefaultEnvironmentField";

export function EditProfileParitySlots(props: {
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onMutated?: () => void;
  onCreateEnvironment?: () => void;
}) {
  return (
    <div className="edit-profile-parity-slots">
      <DefaultEnvironmentField
        profileName={props.profileName}
        baseUrl={props.baseUrl}
        token={props.token}
        disabled={props.disabled}
        onMutated={props.onMutated}
        onCreateEnvironment={props.onCreateEnvironment}
      />
    </div>
  );
}
