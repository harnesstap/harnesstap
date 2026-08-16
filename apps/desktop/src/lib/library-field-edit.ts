export type FieldKeyAction = "commit" | "cancel";

export function fieldKeyAction(key: string): FieldKeyAction | null {
  if (key === "Enter") {
    return "commit";
  }
  if (key === "Escape") {
    return "cancel";
  }
  return null;
}
