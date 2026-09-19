import {
  createContext,
  useContext,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import type { ResourceHoverModel } from "../../lib/resource-hover";
import { RelatedHarnessIcons } from "../HarnessIcons";
import { TypeIcon } from "../TypeIcon";
import { Label } from "./label";
import { ResourceHoverCard } from "./resource-hover-card";

const ResourceRowDisabledContext = createContext(false);

export function ResourceRowRoot({
  hover,
  testId,
  className,
  children,
  disabled,
  ariaLabel,
  onActivate,
  role,
  tabIndex,
  id,
  "aria-selected": ariaSelected,
  "aria-current": ariaCurrent,
  onKeyDown,
  onFocus,
}: {
  hover: ResourceHoverModel;
  testId?: string;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  onActivate?: () => void;
  role?: "option" | "listitem";
  tabIndex?: number;
  id?: string;
  "aria-selected"?: boolean;
  "aria-current"?: "true" | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onFocus?: FocusEventHandler<HTMLDivElement>;
}): ReactNode {
  return (
    <ResourceRowDisabledContext.Provider value={Boolean(disabled)}>
      <ResourceHoverCard model={hover} disabled={disabled}>
        <div
          className={cn(
            "resource-row",
            onActivate ? "resource-row-clickable" : null,
            className,
          )}
          id={id}
          role={role}
          tabIndex={tabIndex}
          data-testid={testId}
          aria-label={ariaLabel}
          aria-selected={ariaSelected}
          aria-current={ariaCurrent}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          onClick={
            onActivate && !disabled
              ? (event) => {
                  if (
                    event.target instanceof HTMLElement
                    && event.target.closest("button, a, input, textarea, select")
                    && event.currentTarget !== event.target
                  ) {
                    return;
                  }
                  onActivate();
                }
              : undefined
          }
        >
          {children}
        </div>
      </ResourceHoverCard>
    </ResourceRowDisabledContext.Provider>
  );
}

export function ResourceRowLeading({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={cn("resource-row-leading", className)}>{children}</div>;
}

type ResourceRowIdentityProps = {
  type?: string;
  label: string;
  children?: ReactNode;
  className?: string;
  accessory?: ReactNode;
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
  accessory,
}: ResourceRowIdentityProps): ReactNode {
  const disabled = useContext(ResourceRowDisabledContext);
  let name: ReactNode;
  if (onOpen) {
    name = (
      <button
        type="button"
        className="resource-name-btn"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
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
        {accessory}
      </div>
      {children}
    </div>
  );
}

/** Nest under `ResourceRowIdentity` so the description sits in the identity column. */
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

/** Mono `@<profile>` chip for scoped library copies grouped under a base row. */
export function ResourceRowScopeChip({
  profile,
}: {
  profile: string;
}): ReactNode {
  return <span className="resource-row-scope-chip mono">@{profile}</span>;
}
