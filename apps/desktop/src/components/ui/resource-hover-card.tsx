import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { FileText, Folder, Package, Pencil, Store } from "lucide-react";
import { Tooltip } from "radix-ui";
import { labelForType } from "../../lib/contents-diff";
import { harnessDisplayName } from "../../lib/harness-meta";
import { formatOriginKindLabel } from "../../lib/resource-filters";
import {
  formatHoverPath,
  resourceHoverCardHasContent,
  type ResourceHoverExtra,
  type ResourceHoverModel,
} from "../../lib/resource-hover";
import { HarnessMark } from "../HarnessIcons";
import { TypeIcon } from "../TypeIcon";

const ICON_SIZE = 14;
const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 150;
const COLLISION_PADDING = 8;

function OriginHoverIcon({ originKind }: { originKind: string }): ReactNode {
  switch (originKind) {
    case "marketplace_link":
      return <Store size={ICON_SIZE} aria-hidden />;
    case "local_snapshot":
      return <Folder size={ICON_SIZE} aria-hidden />;
    case "manual":
      return <Pencil size={ICON_SIZE} aria-hidden />;
    default:
      return <Package size={ICON_SIZE} aria-hidden />;
  }
}

function ExtraHoverIcon({ extra }: { extra: ResourceHoverExtra }): ReactNode {
  switch (extra.kind) {
    case "destinations":
      return <Folder size={ICON_SIZE} aria-hidden />;
    default: {
      const neverKind: never = extra.kind;
      return neverKind;
    }
  }
}

function HoverCardRow({
  icon,
  text,
  mono,
}: {
  icon: ReactNode;
  text: string;
  mono?: boolean;
}): ReactNode {
  return (
    <div className="resource-hover-card-row">
      {icon}
      <span className={mono ? "mono" : undefined}>{text}</span>
    </div>
  );
}

export function ResourceHoverCard({
  model,
  children,
  disabled = false,
}: {
  model: ResourceHoverModel;
  children: ReactNode;
  disabled?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(0);
  const showTooltip = !disabled && resourceHoverCardHasContent(model);

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = 0;
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      cancelClose();
      if (next) {
        setOpen(true);
        return;
      }
      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        closeTimerRef.current = 0;
      }, CLOSE_DELAY_MS);
    },
    [cancelClose],
  );

  const handleFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (!event.target.matches(":focus-visible")) {
        return;
      }
      cancelClose();
      setOpen(true);
    },
    [cancelClose],
  );

  useEffect(() => {
    return () => {
      window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showTooltip) {
      cancelClose();
      setOpen(false);
    }
  }, [cancelClose, showTooltip]);

  if (!showTooltip) {
    return children;
  }

  const firstHarnessId = model.harnessIds[0];

  return (
    <Tooltip.Provider
      delayDuration={OPEN_DELAY_MS}
      disableHoverableContent
    >
      <Tooltip.Root
        open={open}
        onOpenChange={handleOpenChange}
        delayDuration={OPEN_DELAY_MS}
        disableHoverableContent
      >
        <Tooltip.Trigger asChild onFocusCapture={handleFocusCapture}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal container={document.body}>
          <Tooltip.Content
            className="resource-hover-card"
            role="tooltip"
            side="top"
            collisionPadding={COLLISION_PADDING}
            sideOffset={6}
          >
            {model.type !== undefined ? (
              <HoverCardRow
                icon={<TypeIcon type={model.type} />}
                text={labelForType(model.type, 1)}
              />
            ) : null}
            {model.originKind !== undefined ? (
              <HoverCardRow
                icon={<OriginHoverIcon originKind={model.originKind} />}
                text={formatOriginKindLabel(model.originKind)}
              />
            ) : null}
            {model.path !== undefined ? (
              <HoverCardRow
                icon={<FileText size={ICON_SIZE} aria-hidden />}
                text={formatHoverPath(model.path)}
                mono
              />
            ) : null}
            {firstHarnessId !== undefined ? (
              <HoverCardRow
                icon={<HarnessMark id={firstHarnessId} />}
                text={model.harnessIds.map(harnessDisplayName).join(", ")}
              />
            ) : null}
            {model.extra.map((extra) => (
              <HoverCardRow
                key={`${extra.kind}-${extra.text}`}
                icon={<ExtraHoverIcon extra={extra} />}
                text={extra.text}
              />
            ))}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
