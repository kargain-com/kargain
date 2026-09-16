/**
 * Shared processor extraction for SVM entrypoint account-binding pins.
 * Locate a named `fn`, extract `next_account_info` order, refuse by named cause.
 * Product suites (verify, open-challenge, …) import this — do not copy.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Locate `fn <fnName>` and return its brace-closed body.
 * Refuses by named cause when the function cannot be located or the body is empty.
 */
export function locateEntrypointFnBody(source: string, fnName: string): string {
  const sig = `fn ${fnName}`;
  const sigIdx = source.indexOf(sig);
  if (sigIdx < 0) {
    throw new Error(`${fnName}_not_found`);
  }

  const afterSig = source.slice(sigIdx);
  const bodyOpen = afterSig.indexOf("{");
  if (bodyOpen < 0) {
    throw new Error(`${fnName}_body_missing`);
  }

  let depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < afterSig.length; i++) {
    const ch = afterSig[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`${fnName}_body_unclosed`);
  }

  const body = afterSig.slice(bodyOpen, end + 1);
  if (body.trim().length <= 2) {
    throw new Error(`${fnName}_body_empty`);
  }
  return body;
}

/** Read entrypoint from disk and locate `fn <fnName>`. */
export function readEntrypointFnBody(
  root: string,
  entrypointRel: string,
  fnName: string,
): string {
  const abs = path.join(root, entrypointRel);
  let source: string;
  try {
    source = readFileSync(abs, "utf8");
  } catch (err) {
    throw new Error(
      `entrypoint_unreadable:${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return locateEntrypointFnBody(source, fnName);
}

/**
 * Extract binding names from `let name = next_account_info(iter)?` in order.
 * When `minCount` is set and under-bound, refuses with `binding_count_below_<n>:…`.
 */
export function extractNextAccountBindings(
  body: string,
  minCount?: number,
): string[] {
  const names: string[] = [];
  const re = /let\s+(\w+)\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    names.push(m[1]!);
  }
  if (minCount != null && names.length < minCount) {
    throw new Error(
      `binding_count_below_${minCount === 5 ? "five" : String(minCount)}:got_${names.length}:${names.join(",")}`,
    );
  }
  return names;
}

export function assertBindingOrder(
  bindings: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  assert.deepEqual([...bindings], [...expected], label);
}

export function assertBindingIsSigner(
  body: string,
  binding: string,
  label: string,
): void {
  const signerRe = new RegExp(`\\b${binding}\\.is_signer\\b`);
  assert.match(body, signerRe, label);
}

export function saveStateTargets(body: string): string[] {
  const targets: string[] = [];
  const re = /save_state\s*\(\s*(\w+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    targets.push(m[1]!);
  }
  return targets;
}
