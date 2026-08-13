import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ResourceHoverModel } from "../../lib/resource-hover";
import { RelatedHarnessIcons } from "../HarnessIcons";
import { TypeIcon } from "../TypeIcon";
import { Label } from "./label";
import { ResourceHoverCard } from "./resource-hover-card";

export function ResourceRowRoot({
  hover,
  testId,
  className,
  children,
  disabled,
}: {
  hover: ResourceHoverModel;
  testId?: string;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
}): ReactNode {
  return (
    <ResourceHoverCard model={hover} disabled={disabled}>
      <div className={cn("resource-row", className)} data-testid={testId}>
        {children}
      </div>
    </ResourceHoverCard>
  );
}

export function ResourceRowLeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={cn("resource-row-leading", className)}>{children}</div>;
}

type ResourceRowIdentityProps = {
  type?: string;
  label: string;
  children?: ReactNode;
  className?: string;
} & (
  | { onOpen: () => void; htmlFor?: never }
  | { htmlFor: string; onOpen?: never }
  | { onOpen?: never; htmlFor?: never }
);

export function ResourceRowIdentity({
  type,
  label,
  htmlFor,
  onOpen,
  children,
  className,
}: ResourceRowIdentityProps): ReactNode {
  let name: ReactNode;
  if (onOpen) {
    name = (
      <button type="button" className="resource-name-btn" onClick={onOpen}>
        {label}
      </button>
    );
  } else if (htmlFor) {
    name = (
      <Label htmlFor={htmlFor} className="resource-row-name">
        {label}
      </Label>
    );
  } else {
    name = <span className="resource-row-name">{label}</span>;
  }

  return (
    <div className={cn("resource-row-identity", className)}>
      <div className="resource-row-identity-main">
        {type ? <TypeIcon type={type} /> : null}
        {name}
      </div>
      {children}
    </div>
  );
}

export function ResourceRowDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <span className={cn("resource-row-desc muted", className)}>{children}</span>
  );
}

export function ResourceRowMeta({
  harnessIds,
  className,
}: {
  harnessIds: readonly string[];
  className?: string;
}): ReactNode {
  return (
    <div className={cn("resource-row-meta", className)}>
      <RelatedHarnessIcons harnessIds={harnessIds} tooltip={false} />
    </div>
  );
}

export function ResourceRowTrailing({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn("resource-row-trailing", className)}>{children}</div>
  );
}
