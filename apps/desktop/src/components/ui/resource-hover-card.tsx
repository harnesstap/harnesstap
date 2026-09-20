import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FileText, Folder, Package, Store } from "lucide-react";
import { labelForType } from "../../lib/contents-diff";
import { harnessDisplayName } from "../../lib/harness-meta";
import { formatOriginDisplayLabel } from "../../lib/resource-display";
import { originFilterValue } from "../../lib/resource-filters";
import {
  clampPointerHoverCardPosition,
  formatHoverPath,
  pointerHoverCardStyle,
  resourceHoverCardHasContent,
  type ResourceHoverExtra,
  type ResourceHoverModel,
} from "../../lib/resource-hover";
import { HarnessMark } from "../HarnessIcons";
import { TypeIcon } from "../TypeIcon";

const ICON_SIZE = 14;
const OPEN_DELAY_MS = 400;
const SKIP_DELAY_MS = 300;

let lastHoverCloseAt = 0;

function OriginHoverIcon({ originKind }: { originKind: string }): ReactNode {
  switch (originFilterValue(originKind)) {
    case "marketplace_link":
      return <Store size={ICON_SIZE} aria-hidden />;
    case "local":
      return <Folder size={ICON_SIZE} aria-hidden />;
    default:
      return <Package size={ICON_SIZE} aria-hidden />;
  }
}

function ExtraHoverIcon({ extra }: { extra: ResourceHoverExtra }): ReactNode {
  switch (extra.kind) {
    case "destinations":
      return <Folder size={ICON_SIZE} aria-hidden />;
    case "note":
      return <FileText size={ICON_SIZE} aria-hidden />;
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
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [cardPos, setCardPos] = useState({ left: 0, top: 0 });
  const pointRef = useRef({ x: 0, y: 0 });
  const pointerInRowRef = useRef(false);
  const openTimerRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const showTooltip = !disabled && resourceHoverCardHasContent(model);

  const clearOpenTimer = useCallback(() => {
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = 0;
  }, []);

  const capturePoint = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      return;
    }
    pointRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const closeNow = useCallback(() => {
    clearOpenTimer();
    setOpen((wasOpen) => {
      if (wasOpen) {
        lastHoverCloseAt = Date.now();
      }
      return false;
    });
  }, [clearOpenTimer]);

  const revealAtPointer = useCallback((pointer: { x: number; y: number }) => {
    pointRef.current = pointer;
    setPoint(pointer);
    setCardPos(
      clampPointerHoverCardPosition(
        pointer,
        { width: 0, height: 0 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    setOpen(true);
  }, []);

  const handlePointerEnter = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      pointerInRowRef.current = true;
      capturePoint(event);
      clearOpenTimer();
      const delay =
        Date.now() - lastHoverCloseAt < SKIP_DELAY_MS ? 0 : OPEN_DELAY_MS;
      openTimerRef.current = window.setTimeout(() => {
        revealAtPointer(pointRef.current);
      }, delay);
    },
    [capturePoint, clearOpenTimer, revealAtPointer],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      capturePoint(event);
    },
    [capturePoint],
  );

  const handlePointerLeave = useCallback(() => {
    pointerInRowRef.current = false;
    closeNow();
  }, [closeNow]);

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    if (!event.target.matches(":focus-visible")) {
      return;
    }
    pointerInRowRef.current = true;
    const rect = event.target.getBoundingClientRect();
    revealAtPointer({ x: rect.left, y: rect.bottom });
  }, [revealAtPointer]);

  const handleBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    pointerInRowRef.current = false;
    closeNow();
  }, [closeNow]);

  useEffect(() => {
    return () => {
      window.clearTimeout(openTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showTooltip) {
      pointerInRowRef.current = false;
      closeNow();
    }
  }, [closeNow, showTooltip]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const node = contentRef.current;
    if (!node) {
      return;
    }
    const apply = () => {
      setCardPos(
        clampPointerHoverCardPosition(
          point,
          { width: node.offsetWidth, height: node.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [open, point]);

  if (!showTooltip) {
    return children;
  }

  const firstHarnessId = model.harnessIds[0];

  const card = (
    <div
      ref={contentRef}
      className="resource-hover-card"
      role="tooltip"
      data-state="instant-open"
      style={pointerHoverCardStyle(cardPos)}
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
          text={formatOriginDisplayLabel(model.originKind, model.originRef, {
            includeRef: model.originIncludeRef ?? true,
          })}
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
    </div>
  );

  return (
    <>
      <div
        className="resource-hover-card-host"
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onFocusCapture={handleFocusCapture}
        onBlur={handleBlur}
      >
        {children}
      </div>
      {open ? createPortal(card, document.body) : null}
    </>
  );
}
