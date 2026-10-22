import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

const DEFAULT_CHUNK_BYTES = 64 * 1024;

/**
 * Hash a file the way `hashGeneratedContent(readFileSync(path).toString("utf-8"))`
 * does (decode as UTF-8, turn CRLF into LF, drop trailing line feeds, SHA-256),
 * but read it in chunks so a large file is never held in memory whole.
 * Returns undefined when the file cannot be read.
 */
export function hashFileContentStreaming(
  fullPath: string,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): string | undefined {
  let fd: number;
  try {
    fd = openSync(fullPath, "r");
  } catch {
    return undefined;
  }
  try {
    const hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const buffer = Buffer.allocUnsafe(Math.max(1, chunkBytes));
    // A trailing CR waits for the next chunk (it may start a CRLF), and
    // trailing LFs wait until later content proves they are not at the end.
    let heldCarriageReturn = false;
    let pendingLineFeeds = 0;
    const feed = (decoded: string): void => {
      let text = heldCarriageReturn ? `\r${decoded}` : decoded;
      heldCarriageReturn = false;
      if (text.endsWith("\r")) {
        heldCarriageReturn = true;
        text = text.slice(0, -1);
      }
      if (text.includes("\r\n")) text = text.replace(/\r\n/g, "\n");
      let end = text.length;
      while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
      if (end === 0) {
        pendingLineFeeds += text.length;
        return;
      }
      if (pendingLineFeeds > 0) hash.update("\n".repeat(pendingLineFeeds), "utf8");
      hash.update(end === text.length ? text : text.slice(0, end), "utf8");
      pendingLineFeeds = text.length - end;
    };
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      feed(decoder.decode(buffer.subarray(0, read), { stream: true }));
    }
    feed(decoder.decode());
    if (heldCarriageReturn) {
      if (pendingLineFeeds > 0) hash.update("\n".repeat(pendingLineFeeds), "utf8");
      hash.update("\r", "utf8");
    }
    return `sha256:${hash.digest("hex")}`;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}
