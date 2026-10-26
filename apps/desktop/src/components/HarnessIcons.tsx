import type { ReactNode, SVGProps } from "react";
import { HARNESS_MARKS } from "../lib/harness-marks";
import { harnessDisplayName } from "../lib/harness-meta";
import { ChromeTooltip } from "./ChromeTooltip";

const ICON_SIZE = 14;

type HarnessMarkProps = SVGProps<SVGSVGElement> & {
  id: string;
  size?: number;
};

/**
 * Harness ids reach the UI from settings, scopes and detected configs, not
 * always in catalog form ("OpenCode", "open_code"). Fold them to the catalog
 * id so every surface finds the real logo instead of a placeholder.
 */
export function harnessMarkId(id: string): string {
  const folded = id.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (HARNESS_MARKS[folded]) {
    return folded;
  }
  const squashed = folded.replace(/-/g, "");
  return Object.keys(HARNESS_MARKS).find((key) => key.replace(/-/g, "") === squashed) ?? folded;
}

export function HarnessMark({ id, size = ICON_SIZE, ...props }: HarnessMarkProps): ReactNode {
  const mark = HARNESS_MARKS[harnessMarkId(id)];
  if (!mark) {
    const letter = (id[0] ?? "?").toUpperCase();
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        focusable="false"
        {...props}
      >
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <text
          x="8"
          y="11"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="currentColor"
        >
          {letter}
        </text>
      </svg>
    );
  }

  const viewBox = mark.viewBox ?? "0 0 24 24";
  const inset = mark.inset ?? 1;
  const [, , vbW = "24", vbH = "24"] = viewBox.split(/\s+/);
  const cx = Number(vbW) / 2;
  const cy = Number(vbH) / 2;

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
      {...props}
    >
      {inset === 1 ? (
        <path fill="currentColor" d={mark.path} />
      ) : (
        <g transform={`translate(${cx} ${cy}) scale(${inset}) translate(${-cx} ${-cy})`}>
          <path fill="currentColor" d={mark.path} />
        </g>
      )}
    </svg>
  );
}

export function HarnessIcon({
  id,
  size = ICON_SIZE,
  tooltip = true,
}: {
  id: string;
  size?: number;
  tooltip?: boolean;
}): ReactNode {
  const name = harnessDisplayName(id);
  const icon = (
    <span className={`harness-icon harness-icon-${id}`}>
      <HarnessMark id={id} size={size} />
      <span className="sr-only">{name}</span>
    </span>
  );
  return tooltip ? <ChromeTooltip content={name}>{icon}</ChromeTooltip> : icon;
}

export function RelatedHarnessIcons({
  harnessIds,
  size = ICON_SIZE,
  label = "Related harnesses",
  tooltip = true,
}: {
  harnessIds: readonly string[];
  size?: number;
  label?: string;
  tooltip?: boolean;
}): ReactNode {
  if (harnessIds.length === 0) {
    return null;
  }
  return (
    <span className="harness-icon-row" aria-label={label}>
      {harnessIds.map((harnessId) => (
        <HarnessIcon
          key={harnessId}
          id={harnessId}
          size={size}
          tooltip={tooltip}
        />
      ))}
    </span>
  );
}
