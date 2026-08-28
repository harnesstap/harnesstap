/** Hidden-Unicode scanner aligned with OpenAPM ContentScanner (pack-time gate). */

export type UnicodeScanSeverity = "critical" | "warning" | "info";

export interface UnicodeScanFinding {
  file: string;
  line: number;
  column: number;
  codepoint: string;
  severity: UnicodeScanSeverity;
  category: string;
  description: string;
}

interface RangeEntry {
  start: number;
  end: number;
  severity: UnicodeScanSeverity;
  category: string;
  description: string;
}

const SUSPICIOUS_RANGES: RangeEntry[] = [
  {
    start: 0xe0001,
    end: 0xe007f,
    severity: "critical",
    category: "tag-character",
    description: "Unicode tag character (invisible ASCII mapping)",
  },
  {
    start: 0x202a,
    end: 0x202a,
    severity: "critical",
    category: "bidi-override",
    description: "Left-to-right embedding (LRE)",
  },
  {
    start: 0x202b,
    end: 0x202b,
    severity: "critical",
    category: "bidi-override",
    description: "Right-to-left embedding (RLE)",
  },
  {
    start: 0x202c,
    end: 0x202c,
    severity: "critical",
    category: "bidi-override",
    description: "Pop directional formatting (PDF)",
  },
  {
    start: 0x202d,
    end: 0x202d,
    severity: "critical",
    category: "bidi-override",
    description: "Left-to-right override (LRO)",
  },
  {
    start: 0x202e,
    end: 0x202e,
    severity: "critical",
    category: "bidi-override",
    description: "Right-to-left override (RLO)",
  },
  {
    start: 0x2066,
    end: 0x2066,
    severity: "critical",
    category: "bidi-override",
    description: "Left-to-right isolate (LRI)",
  },
  {
    start: 0x2067,
    end: 0x2067,
    severity: "critical",
    category: "bidi-override",
    description: "Right-to-left isolate (RLI)",
  },
  {
    start: 0x2068,
    end: 0x2068,
    severity: "critical",
    category: "bidi-override",
    description: "First strong isolate (FSI)",
  },
  {
    start: 0x2069,
    end: 0x2069,
    severity: "critical",
    category: "bidi-override",
    description: "Pop directional isolate (PDI)",
  },
  {
    start: 0xe0100,
    end: 0xe01ef,
    severity: "critical",
    category: "variation-selector",
    description: "Variation selector (SMP) — no legitimate use in prompt files",
  },
  {
    start: 0x200b,
    end: 0x200b,
    severity: "warning",
    category: "zero-width",
    description: "Zero-width space",
  },
  {
    start: 0x200c,
    end: 0x200c,
    severity: "warning",
    category: "zero-width",
    description: "Zero-width non-joiner (ZWNJ)",
  },
  {
    start: 0x200d,
    end: 0x200d,
    severity: "warning",
    category: "zero-width",
    description: "Zero-width joiner (ZWJ)",
  },
  {
    start: 0x2060,
    end: 0x2060,
    severity: "warning",
    category: "zero-width",
    description: "Word joiner",
  },
  {
    start: 0xfe00,
    end: 0xfe0d,
    severity: "warning",
    category: "variation-selector",
    description: "Variation selector (CJK typography variant)",
  },
  {
    start: 0xfe0e,
    end: 0xfe0e,
    severity: "warning",
    category: "variation-selector",
    description: "Text presentation selector",
  },
  {
    start: 0x00ad,
    end: 0x00ad,
    severity: "warning",
    category: "invisible-formatting",
    description: "Soft hyphen",
  },
  {
    start: 0x200e,
    end: 0x200e,
    severity: "warning",
    category: "bidi-mark",
    description: "Left-to-right mark (LRM)",
  },
  {
    start: 0x200f,
    end: 0x200f,
    severity: "warning",
    category: "bidi-mark",
    description: "Right-to-left mark (RLM)",
  },
  {
    start: 0x061c,
    end: 0x061c,
    severity: "warning",
    category: "bidi-mark",
    description: "Arabic letter mark (ALM)",
  },
  {
    start: 0x2061,
    end: 0x2061,
    severity: "warning",
    category: "invisible-formatting",
    description: "Function application (invisible operator)",
  },
  {
    start: 0x2062,
    end: 0x2062,
    severity: "warning",
    category: "invisible-formatting",
    description: "Invisible times",
  },
  {
    start: 0x2063,
    end: 0x2063,
    severity: "warning",
    category: "invisible-formatting",
    description: "Invisible separator",
  },
  {
    start: 0x2064,
    end: 0x2064,
    severity: "warning",
    category: "invisible-formatting",
    description: "Invisible plus",
  },
  {
    start: 0xfff9,
    end: 0xfff9,
    severity: "warning",
    category: "annotation-marker",
    description: "Interlinear annotation anchor",
  },
  {
    start: 0xfffa,
    end: 0xfffa,
    severity: "warning",
    category: "annotation-marker",
    description: "Interlinear annotation separator",
  },
  {
    start: 0xfffb,
    end: 0xfffb,
    severity: "warning",
    category: "annotation-marker",
    description: "Interlinear annotation terminator",
  },
  {
    start: 0x206a,
    end: 0x206f,
    severity: "warning",
    category: "deprecated-formatting",
    description: "Deprecated formatting character",
  },
  {
    start: 0xfe0f,
    end: 0xfe0f,
    severity: "info",
    category: "variation-selector",
    description: "Emoji presentation selector",
  },
  {
    start: 0x00a0,
    end: 0x00a0,
    severity: "info",
    category: "unusual-whitespace",
    description: "Non-breaking space",
  },
  {
    start: 0x2000,
    end: 0x200a,
    severity: "info",
    category: "unusual-whitespace",
    description: "Unicode whitespace character",
  },
  {
    start: 0x205f,
    end: 0x205f,
    severity: "info",
    category: "unusual-whitespace",
    description: "Medium mathematical space",
  },
  {
    start: 0x3000,
    end: 0x3000,
    severity: "info",
    category: "unusual-whitespace",
    description: "Ideographic space",
  },
  {
    start: 0x180e,
    end: 0x180e,
    severity: "info",
    category: "unusual-whitespace",
    description: "Mongolian vowel separator",
  },
];

const CHAR_LOOKUP = new Map<number, Omit<RangeEntry, "start" | "end">>();
for (const range of SUSPICIOUS_RANGES) {
  for (let cp = range.start; cp <= range.end; cp++) {
    CHAR_LOOKUP.set(cp, {
      severity: range.severity,
      category: range.category,
      description: range.description,
    });
  }
}

function isAscii(content: string): boolean {
  for (let i = 0; i < content.length; i++) {
    if ((content.charCodeAt(i) ?? 0) > 0x7f) return false;
  }
  return true;
}

function isEmojiChar(ch: string): boolean {
  return /\p{Extended_Pictographic}/u.test(ch) || /\p{So}/u.test(ch);
}

function zwjInEmojiContext(chars: string[], index: number): boolean {
  let prev = index - 1;
  while (prev >= 0) {
    const cp = chars[prev]?.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || (cp >= 0x1f3fb && cp <= 0x1f3ff)) {
      prev -= 1;
      continue;
    }
    break;
  }
  const prevOk = prev >= 0 && isEmojiChar(chars[prev] ?? "");
  const next = chars[index + 1] ?? "";
  return prevOk && isEmojiChar(next);
}

export function scanUnicodeText(content: string, filename = ""): UnicodeScanFinding[] {
  if (!content || isAscii(content)) {
    return [];
  }

  const findings: UnicodeScanFinding[] = [];
  const lines = content.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx] ?? "";
    const chars = [...lineText];
    let column = 1;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i] ?? "";
      const cp = ch.codePointAt(0) ?? 0;

      if (cp === 0xfeff) {
        const atStart = lineIdx === 0 && i === 0;
        findings.push({
          file: filename,
          line: lineIdx + 1,
          column,
          codepoint: "U+FEFF",
          severity: atStart ? "info" : "warning",
          category: atStart ? "bom" : "zero-width",
          description: atStart
            ? "Byte order mark at start of file"
            : "Byte order mark in middle of file (possible hidden content)",
        });
        column += 1;
        continue;
      }

      const entry = CHAR_LOOKUP.get(cp);
      if (entry) {
        let severity = entry.severity;
        let description = entry.description;
        if (cp === 0x200d && zwjInEmojiContext(chars, i)) {
          severity = "info";
          description = "Zero-width joiner (emoji sequence)";
        }
        findings.push({
          file: filename,
          line: lineIdx + 1,
          column,
          codepoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
          severity,
          category: entry.category,
          description,
        });
      }
      column += 1;
    }
  }

  return findings;
}

export function scanUnicodeBuffer(buffer: Buffer, filename = ""): UnicodeScanFinding[] {
  if (buffer.includes(0)) {
    return [];
  }
  let text: string;
  try {
    text = buffer.toString("utf8");
  } catch {
    return [];
  }
  if (text.includes("\uFFFD") && !buffer.toString("utf8", 0, Math.min(buffer.length, 4)).includes("\uFFFD")) {
    return [];
  }
  if (text.includes("\uFFFD")) {
    return [];
  }
  return scanUnicodeText(text, filename);
}

export function hasCriticalUnicode(findings: UnicodeScanFinding[]): boolean {
  return findings.some((finding) => finding.severity === "critical");
}

export function summarizeUnicodeFindings(
  findings: UnicodeScanFinding[],
): Record<UnicodeScanSeverity, number> {
  const counts: Record<UnicodeScanSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

export function formatUnicodeFinding(finding: UnicodeScanFinding): string {
  return `${finding.file}:${finding.line}:${finding.column} ${finding.codepoint} ${finding.description}`;
}

export class CriticalUnicodeError extends Error {
  readonly findings: UnicodeScanFinding[];

  constructor(findings: UnicodeScanFinding[]) {
    const critical = findings.filter((finding) => finding.severity === "critical");
    const first = critical[0];
    super(
      `Critical hidden Unicode in ${first?.file ?? "content"} ` +
        `(${first?.codepoint ?? "U+????"} ${first?.description ?? "critical character"}). ` +
        "Re-run with --force to override.",
    );
    this.name = "CriticalUnicodeError";
    this.findings = findings;
  }
}

export function assertUnicodeAllowed(
  findings: UnicodeScanFinding[],
  force = false,
): void {
  if (hasCriticalUnicode(findings) && !force) {
    throw new CriticalUnicodeError(findings);
  }
}

export function isStrippableUnicodeFinding(finding: UnicodeScanFinding): boolean {
  return finding.severity === "critical" || finding.severity === "warning";
}

/**
 * Remove critical and warning hidden-Unicode code points.
 * Info-level characters (emoji presentation, unusual whitespace, ZWJ in emoji
 * sequences) are preserved.
 */
export function stripHiddenUnicode(content: string): { text: string; removed: number } {
  const findings = scanUnicodeText(content);
  const stripAt = new Set(
    findings
      .filter(isStrippableUnicodeFinding)
      .map((finding) => `${finding.line}:${finding.column}`),
  );
  if (stripAt.size === 0) {
    return { text: content, removed: 0 };
  }

  const lines = content.split("\n");
  let removed = 0;
  const out: string[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx] ?? "";
    const chars = [...lineText];
    let column = 1;
    const kept: string[] = [];
    for (const ch of chars) {
      if (stripAt.has(`${lineIdx + 1}:${column}`)) {
        removed += 1;
      } else {
        kept.push(ch);
      }
      column += 1;
    }
    out.push(kept.join(""));
  }
  return { text: out.join("\n"), removed };
}
