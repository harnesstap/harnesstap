import { CircleCheck, Circle, Minus } from "lucide-react";

export type StatusPillKind = "active" | "inactive" | "not-in-profile";

const STATUS_PILL: Record<StatusPillKind, { label: string; Icon: typeof Circle }> = {
  active: { label: "Active", Icon: CircleCheck },
  inactive: { label: "Inactive", Icon: Circle },
  "not-in-profile": { label: "Not in profile", Icon: Minus },
};

export function statusPillLabel(kind: StatusPillKind): string {
  return STATUS_PILL[kind].label;
}

/** One pill style for status words: icon plus text, never color alone. */
export function StatusPill({ kind }: { kind: StatusPillKind }) {
  const { label, Icon } = STATUS_PILL[kind];
  return (
    <span className="meta-chip status-pill" data-status={kind} data-testid="status-pill">
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
