// Tiny lexer shared by the HarnessTap design lints. No dependencies.
// classify(text, ext) returns a Uint8Array with one entry per UTF-16 unit:
//   0 = code, 1 = comment, 2 = string (quotes, template literals).
// It is a heuristic, not a parser: good enough to ignore comments and to
// tell string literals from identifiers. Regex literals are treated as code.
export const CODE = 0;
export const COMMENT = 1;
export const STRING = 2;

const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const CSS_EXT = new Set([".css", ".scss", ".pcss"]);
const HTML_EXT = new Set([".html", ".htm", ".vue", ".svelte"]);

export function kindOf(ext) {
  if (JS_EXT.has(ext)) return "js";
  if (CSS_EXT.has(ext)) return "css";
  if (HTML_EXT.has(ext)) return "html";
  return "text";
}

export function classify(text, ext) {
  const kind = kindOf(ext);
  const out = new Uint8Array(text.length);
  if (kind === "text") return out;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (kind === "html" && text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      out.fill(COMMENT, i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out.fill(COMMENT, i, stop);
      i = stop;
      continue;
    }
    if (kind === "js" && c === "/" && d === "/") {
      let stop = text.indexOf("\n", i);
      if (stop === -1) stop = n;
      out.fill(COMMENT, i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || (kind === "js" && c === "`")) {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++;
        else if (c !== "`" && text[j] === "\n") break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      out.fill(STRING, i, stop);
      i = stop;
      continue;
    }
    i++;
  }
  return out;
}

export function lineCol(text, index) {
  let line = 1;
  let last = -1;
  for (let k = 0; k < index; k++) {
    if (text.charCodeAt(k) === 10) {
      line++;
      last = k;
    }
  }
  return { line, column: index - last };
}
