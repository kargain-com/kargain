/**
 * Shared scanners for messaging P10 invariants.
 * Every textual/structural checker used against the live tree must also be
 * exercised with a constructed dirty fixture (and a clean twin).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const XMTP_ADAPTER = path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts");
export const CACHE_ADAPTER = path.join(ROOT, "lib/messaging/adapters/cache-adapter.ts");

export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

export function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

export function walkMessagingLib(): string[] {
  return listTsFiles(path.join(ROOT, "lib/messaging"));
}

/** Top-level function bodies (brace-matched) — used by I1 same-body scanner. */
export function extractTopLevelBodies(
  source: string,
): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const startRe =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{|(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = startRe.exec(source)) !== null) {
    const name = match[1] ?? match[2] ?? "anonymous";
    if (name === "if" || name === "for" || name === "while" || name === "switch") continue;
    const openIdx = match.index + match[0].length - 1;
    let depth = 0;
    let i = openIdx;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
    out.push({ name, body: source.slice(openIdx, i) });
  }
  return out;
}

function armsWallClockAbort(body: string): boolean {
  return (
    /setTimeout\s*\(\s*\(\)\s*=>\s*[\w.]+\.abort\b/.test(body) ||
    /setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*[\w.]+\.abort\b/.test(body)
  );
}

function reachesModuleLoader(body: string): boolean {
  return /\bloadXmtp\s*\(/.test(body) || /\bensureModuleLoaded\s*\(/.test(body);
}

/** I1 — functions that arm a wall-clock abort and reach the module loader. */
export function wallClockLoaderViolations(source: string): string[] {
  return extractTopLevelBodies(source)
    .filter(({ body }) => armsWallClockAbort(body) && reachesModuleLoader(body))
    .map(({ name }) => name);
}

/** I4 — localStorage / sessionStorage mentions outside cache-adapter. */
export function browserStorageViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/\blocalStorage\b/.test(text)) hits.push("localStorage");
  if (/\bsessionStorage\b/.test(text)) hits.push("sessionStorage");
  return hits;
}

/** I12 — Client.create / Client.build outside adapter. */
export function clientFactoryViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/\bClient\.create\s*\(/.test(text)) hits.push("Client.create");
  if (/\bClient\.build\s*\(/.test(text)) hits.push("Client.build");
  return hits;
}

/** I12 — raw syncAll / conversations.sync outside adapter. */
export function rawSyncViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/\.syncAll\s*\(/.test(text)) hits.push("syncAll");
  if (/conversations\.sync\s*\(/.test(text)) hits.push("conversations.sync");
  return hits;
}

/** I5 — module-scope session Maps. */
export function moduleScopeSessionMapViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/const\s+sessions\s*=\s*new\s+Map/.test(text)) hits.push("sessions Map");
  if (/Map<\s*string\s*,\s*[^>]*MessagingSession/.test(text)) {
    hits.push("MessagingSession Map");
  }
  return hits;
}

/** I5 — React imports in session-core sources. */
export function reactInSessionCoreViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/from\s+["']react["']/.test(text) || /from\s+["']react\//.test(text)) {
    hits.push("react import");
  }
  if (/\buse(State|Effect|Ref|Context|Memo|Callback)\b/.test(text)) {
    hits.push("react hook");
  }
  return hits;
}

/** I7 — setInterval sync drivers. */
export function timerSyncViolations(source: string): string[] {
  const text = stripComments(source);
  return text.includes("setInterval") ? ["setInterval"] : [];
}

/** I8 — send APIs on entry surfaces. */
export function entrySendViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/\.sendText\s*\(/.test(text)) hits.push("sendText");
  if (/\.send\s*\(/.test(text)) hits.push("send");
  return hits;
}

/** I9 — querySync on a publish-path owner body. */
export function querySyncViolations(source: string): string[] {
  return /\.querySync\s*\(/.test(stripComments(source)) ? ["querySync"] : [];
}

export function scanTree(
  dirs: string[],
  check: (source: string, file: string) => string[],
  opts?: { exclude?: (file: string) => boolean },
): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    for (const file of listTsFiles(dir)) {
      if (opts?.exclude?.(file)) continue;
      for (const hit of check(fs.readFileSync(file, "utf8"), file)) {
        found.push(`${path.relative(ROOT, file)}: ${hit}`);
      }
    }
  }
  return found;
}
