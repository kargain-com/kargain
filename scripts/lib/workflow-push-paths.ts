/**
 * Sole owner of GitHub Actions `on.push.paths`: parse the block and match a
 * repo path against it.
 *
 * Glob rules follow the Actions filter cheat sheet: `*` does not cross `/`,
 * `**` does, `?` / `+` quantify the preceding atom, and a leading `!` excludes
 * until a later pattern includes the path again. Patterns match the whole path
 * from the repository root.
 *
 * Guard: test/deploy-ponder-svm-ingest-ci-policy.test.ts
 */
import { JSON_SCHEMA, load as loadYaml } from "js-yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * `on.push.paths` as pattern strings. Fail closed on a missing, empty, or
 * non-list block, and on a YAML document that does not parse.
 */
export function parseWorkflowPushPaths(yamlText: string): string[] {
  let doc: unknown;
  try {
    doc = loadYaml(yamlText, { schema: JSON_SCHEMA });
  } catch {
    throw new Error("workflow paths block is unparsable");
  }
  if (!isRecord(doc) || !isRecord(doc.on) || !isRecord(doc.on.push)) {
    throw new Error("workflow paths block is unparsable");
  }
  const paths = doc.on.push.paths;
  if (!Array.isArray(paths)) {
    throw new Error("workflow paths block is unparsable");
  }
  if (paths.length === 0) {
    throw new Error("workflow paths block is empty");
  }
  const patterns: string[] = [];
  for (const item of paths) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error("workflow paths block is unparsable");
    }
    patterns.push(item);
  }
  return patterns;
}

function unparsable(pattern: string): Error {
  return new Error(`unparsable workflow path pattern: ${pattern}`);
}

/** Whole-path GitHub filter glob. `!` is applied by {@link workflowPathsCover}. */
function compileGithubPathPattern(pattern: string): RegExp {
  if (pattern.length === 0) {
    throw new Error("workflow path pattern is empty");
  }
  let out = "";
  let quantifiable = false;
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      quantifiable = false;
      i += 3;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      out += ".*";
      quantifiable = false;
      i += 2;
      continue;
    }
    const ch = pattern[i]!;
    if (ch === "*") {
      out += "[^/]*";
      quantifiable = false;
      i += 1;
      continue;
    }
    if (ch === "?" || ch === "+") {
      if (!quantifiable) throw unparsable(pattern);
      out += ch;
      quantifiable = false;
      i += 1;
      continue;
    }
    if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) throw unparsable(pattern);
      const body = pattern.slice(i + 1, end);
      if (!/^[A-Za-z0-9-]+$/.test(body)) throw unparsable(pattern);
      out += `[${body}]`;
      quantifiable = true;
      i = end + 1;
      continue;
    }
    if (ch === "]" || ch === "{" || ch === "}") throw unparsable(pattern);
    out += /[\\^$|.()]/.test(ch) ? `\\${ch}` : ch;
    quantifiable = true;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/**
 * Whether `file` would be included by this `paths` list. Patterns apply in
 * order: a match sets inclusion, a later `!` match clears it, a later positive
 * match sets it again.
 */
export function workflowPathsCover(
  patterns: readonly string[],
  file: string,
): boolean {
  if (patterns.length === 0) {
    throw new Error("workflow paths block is empty");
  }
  let covered = false;
  for (const raw of patterns) {
    const negate = raw.startsWith("!");
    const body = negate ? raw.slice(1) : raw;
    if (body.length === 0) {
      throw new Error("workflow path pattern is empty");
    }
    if (compileGithubPathPattern(body).test(file)) {
      covered = !negate;
    }
  }
  return covered;
}

/**
 * Inputs no pattern covers. Fail closed on an empty pattern list or an empty
 * input set — both mean the comparison cannot be trusted.
 */
export function uncoveredWorkflowInputs(
  patterns: readonly string[],
  inputs: readonly string[],
): string[] {
  if (patterns.length === 0) {
    throw new Error("workflow paths block is empty");
  }
  if (inputs.length === 0) {
    throw new Error("deploy input set is empty");
  }
  return inputs.filter((input) => !workflowPathsCover(patterns, input)).sort();
}
