/**
 * Sole owner of local Docker hygiene facts (AGENTS.md § Local Docker).
 * Scripts that run Docker, permitted unscoped removals, local output
 * directories, and the .gitignore → .dockerignore build-context form.
 *
 * Guard: test/local-docker-policy.test.ts
 */

export const DOCKER_CLEAN_SCRIPT = "scripts/docker-clean.ts" as const;
export const DEVELOPER_STACK_PROJECT = "kargain" as const;

export type DockerScriptClass = "harness" | "developer_stack" | "server";

export type DockerHarness = {
  readonly script: string;
  readonly class: "harness";
  /** Compose project owned by this harness; null when containers are named only. */
  readonly composeProject: string | null;
  /** Default container names this harness creates. */
  readonly containerNames: readonly string[];
  /** Image repositories this harness builds. */
  readonly imageRepositories: readonly string[];
  /**
   * Docker image label filters (`label=key=value`) identifying untagged images
   * this harness builds (e.g. rehearsal `com.kargain.ponder.repository=…`).
   */
  readonly imageLabels?: readonly string[];
};

export type DockerDeveloperStack = {
  readonly script: string;
  readonly class: "developer_stack";
  readonly composeProject: typeof DEVELOPER_STACK_PROJECT;
};

export type DockerServerScript = {
  readonly script: string;
  readonly class: "server";
};

export type DockerOwnedScript =
  | DockerHarness
  | DockerDeveloperStack
  | DockerServerScript;

/** Every tracked scripts/* that runs the Docker trigger verbs. */
export const DOCKER_OWNED_SCRIPTS: readonly DockerOwnedScript[] = [
  {
    script: "scripts/e2e-local.sh",
    class: "harness",
    composeProject: null,
    containerNames: ["kargain-e2e-pg"],
    imageRepositories: [],
  },
  {
    script: "scripts/ponder-deploy-rehearsal.sh",
    class: "harness",
    composeProject: "kargain-rehearsal",
    containerNames: [],
    imageRepositories: ["kargain-rehearsal-ponder"],
    imageLabels: [
      "com.kargain.ponder.repository=kargain-rehearsal-ponder",
    ],
  },
  {
    script: "scripts/dev-local.sh",
    class: "developer_stack",
    composeProject: DEVELOPER_STACK_PROJECT,
  },
  {
    script: "scripts/ponder-deploy.sh",
    class: "server",
  },
];

export type PermittedUnscopedRemoval = {
  readonly id: string;
  /** Repo-relative script path that may perform this removal. */
  readonly ownerScript: string;
  /** docker argv after the `docker` binary (owner-driven; no free-text kinds). */
  readonly argv: readonly string[];
};

/**
 * The only unscoped removals allowed in scripts — each has one owner and
 * the exact argv that script may run. ADR 0016 §j stays on ponder-deploy.
 */
export const PERMITTED_UNSCOPED_REMOVALS: readonly PermittedUnscopedRemoval[] = [
  {
    id: "docker-clean-dangling-images",
    ownerScript: DOCKER_CLEAN_SCRIPT,
    argv: ["image", "prune", "-f"],
  },
  {
    id: "docker-clean-builder-72h",
    ownerScript: DOCKER_CLEAN_SCRIPT,
    argv: ["builder", "prune", "-f", "--filter", "until=72h"],
  },
  {
    id: "adr0016-label-image-prune",
    ownerScript: "scripts/ponder-deploy.sh",
    argv: [
      "image",
      "prune",
      "-f",
      "--filter",
      "label=com.kargain.ponder.repository=$repo",
    ],
  },
  {
    id: "adr0016-builder-72h",
    ownerScript: "scripts/ponder-deploy.sh",
    argv: ["builder", "prune", "-f", "--filter", "until=72h"],
  },
];

/**
 * Directories scripts write under the repository root.
 * Each must appear in .gitignore; scratch/chain/db data stay outside the repo.
 *
 * Provenance:
 * - `.ponder/` — Ponder local PGlite (`scripts/lib/ponder-env.ts`)
 * - `.ponder-deploy/` — deploy host state (`scripts/ponder-deploy.sh` / step)
 * - `.vincent-commons/` — `scripts/vincent-derive.ts` / `vincent-assemble.ts`
 */
export const LOCAL_OUTPUT_DIRECTORIES: readonly string[] = [
  ".ponder/",
  ".ponder-deploy/",
  ".vincent-commons/",
];

/** Non-empty, non-comment shell lines (order preserved). */
export function shellActiveLines(source: string): string[] {
  return source.split("\n").filter((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("#");
  });
}

const DOCKER_TRIGGER_RES: readonly RegExp[] = [
  /\bdocker\s+run\b/,
  /\bdocker\s+build\b/,
  /\bdocker\s+compose\s+up\b/,
  /\bdocker\s+compose\s+run\b/,
];

/** Active-line trigger: docker run | build | compose up | compose run. */
export function scriptRunsDocker(source: string): boolean {
  const active = shellActiveLines(source).join("\n");
  return DOCKER_TRIGGER_RES.some((re) => re.test(active));
}

export function dockerHarnesses(
  owned: readonly DockerOwnedScript[] = DOCKER_OWNED_SCRIPTS,
): DockerHarness[] {
  return owned.filter((s): s is DockerHarness => s.class === "harness");
}

export function developerStackProject(
  owned: readonly DockerOwnedScript[] = DOCKER_OWNED_SCRIPTS,
): string {
  const stack = owned.find((s) => s.class === "developer_stack");
  if (!stack || stack.class !== "developer_stack") {
    throw new Error("local-docker: developer stack entry missing");
  }
  return stack.composeProject;
}

export function ownedScriptByPath(
  path: string,
  owned: readonly DockerOwnedScript[] = DOCKER_OWNED_SCRIPTS,
): DockerOwnedScript | undefined {
  return owned.find((s) => s.script === path);
}

export function permittedRemovalsForScript(
  script: string,
  permitted: readonly PermittedUnscopedRemoval[] = PERMITTED_UNSCOPED_REMOVALS,
): PermittedUnscopedRemoval[] {
  return permitted.filter((p) => p.ownerScript === script);
}

/**
 * A tracked script that runs Docker must be listed in exactly one class.
 * Returns defect strings (empty when clean).
 */
export function dockerScriptClassificationDefects(
  files: ReadonlyArray<{ path: string; source: string }>,
  owned: readonly DockerOwnedScript[] = DOCKER_OWNED_SCRIPTS,
): string[] {
  const byPath = new Map(owned.map((s) => [s.script, s]));
  const defects: string[] = [];
  const seen = new Set<string>();
  for (const s of owned) {
    if (seen.has(s.script)) {
      defects.push(`${s.script}: listed more than once`);
    }
    seen.add(s.script);
  }
  for (const f of files) {
    if (!f.path.startsWith("scripts/") || !f.path.endsWith(".sh")) continue;
    if (!scriptRunsDocker(f.source)) continue;
    const entry = byPath.get(f.path);
    if (!entry) {
      defects.push(`${f.path}: runs Docker but is not listed in the owner`);
    }
  }
  for (const s of owned) {
    const file = files.find((f) => f.path === s.script);
    if (!file) {
      defects.push(`${s.script}: listed in the owner but not among scanned files`);
      continue;
    }
    if (!scriptRunsDocker(file.source)) {
      defects.push(
        `${s.script}: listed as ${s.class} but does not run a Docker trigger verb`,
      );
    }
  }
  return defects.sort();
}

/** Match `trap <fn> EXIT INT TERM` (fn is a shell function name). */
const TRAP_HANDLER_RE =
  /\btrap\s+([A-Za-z_][A-Za-z0-9_]*)\s+EXIT\s+INT\s+TERM\b/;

/**
 * Extract the body of `name() { ... }` from shell source (brace-balanced).
 * Returns null when the function is missing or unbalanced.
 */
export function extractShellFunctionBody(
  source: string,
  name: string,
): string | null {
  const startRe = new RegExp(
    `(?:^|\\n)\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\)\\s*\\{`,
  );
  const m = startRe.exec(source);
  if (!m || m.index == null) return null;
  const openIdx = source.indexOf("{", m.index);
  if (openIdx < 0) return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx + 1, i);
      }
    }
  }
  return null;
}

function dockerRmHasVolumeFlag(line: string): boolean {
  return /-v\b/.test(line) || /\brm\s+-[a-zA-Z]*v[a-zA-Z]*\b/.test(line);
}

/** Strip matching quotes from a shell token. */
function unquoteShell(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Resolve a shell word to a concrete string using scalar assignments.
 * Handles literals, `$VAR`, `${VAR}`, and `${VAR:-default}`.
 */
export function resolveShellWord(
  word: string,
  scalars: ReadonlyMap<string, string>,
): string | null {
  const w = unquoteShell(word.trim());
  if (!w) return null;
  const defaulted = /^\$\{([A-Za-z_][A-Za-z0-9_]*):-(.*)\}$/.exec(w);
  if (defaulted) {
    const name = defaulted[1]!;
    const def = defaulted[2]!;
    return scalars.get(name) ?? def;
  }
  const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(w);
  if (braced) return scalars.get(braced[1]!) ?? null;
  const simple = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(w);
  if (simple) return scalars.get(simple[1]!) ?? null;
  if (w.includes("$")) return null;
  return w;
}

/**
 * Scalar `name=value` / `name="${…:-default}"` and array
 * `name=(…)` assignments from active shell lines.
 */
export function parseShellAssignments(source: string): {
  scalars: Map<string, string>;
  arrays: Map<string, string[]>;
} {
  const scalars = new Map<string, string>();
  const arrays = new Map<string, string[]>();
  for (const line of shellActiveLines(source)) {
    const arr = /^([A-Za-z_][A-Za-z0-9_]*)=\((.*)\)\s*$/.exec(line.trim());
    if (arr) {
      const name = arr[1]!;
      const inner = arr[2]!.trim();
      const tokens: string[] = [];
      let cur = "";
      let quote: "'" | '"' | null = null;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i]!;
        if (quote) {
          if (ch === quote) quote = null;
          else cur += ch;
          continue;
        }
        if (ch === "'" || ch === '"') {
          quote = ch;
          continue;
        }
        if (/\s/.test(ch)) {
          if (cur) {
            tokens.push(cur);
            cur = "";
          }
          continue;
        }
        cur += ch;
      }
      if (cur) tokens.push(cur);
      arrays.set(name, tokens);
      continue;
    }
    const scalar = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!scalar) continue;
    const name = scalar[1]!;
    let raw = scalar[2]!.trim();
    // `${VAR:-default}` form assigned as the RHS of E2E_PG_NAME=…
    const defAssign = /^"\$\{([A-Za-z_][A-Za-z0-9_]*):-(.*)\}"$/.exec(raw);
    if (defAssign && defAssign[1] === name) {
      scalars.set(name, defAssign[2]!);
      continue;
    }
    const singleDef = /^'\$\{([A-Za-z_][A-Za-z0-9_]*):-(.*)\}'$/.exec(raw);
    if (singleDef && singleDef[1] === name) {
      scalars.set(name, singleDef[2]!);
      continue;
    }
    raw = unquoteShell(raw);
    const nestedDef = /^\$\{([A-Za-z_][A-Za-z0-9_]*):-(.*)\}$/.exec(raw);
    if (nestedDef && nestedDef[1] === name) {
      scalars.set(name, nestedDef[2]!);
      continue;
    }
    // Plain literal or already-resolved value
    if (!raw.includes("$")) {
      scalars.set(name, raw);
    } else {
      const resolved = resolveShellWord(raw, scalars);
      if (resolved != null) scalars.set(name, resolved);
    }
  }
  return { scalars, arrays };
}

function resolveComposeProjectFromTokens(
  tokens: readonly string[],
  scalars: ReadonlyMap<string, string>,
): string | null {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "-p" || tokens[i] === "--project-name") {
      return resolveShellWord(tokens[i + 1]!, scalars);
    }
  }
  return null;
}

/**
 * True when the trap handler removes an owner-listed container (rm -f -v)
 * or Compose project (down -v), resolving literals and in-script assignments.
 */
export function handlerRemovesOwnedTarget(
  handlerBody: string,
  fullSource: string,
  harness: DockerHarness,
): boolean {
  const { scalars, arrays } = parseShellAssignments(fullSource);
  const handlerLines = shellActiveLines(handlerBody);

  for (const line of handlerLines) {
    if (/\bdocker\s+rm\b/.test(line) && dockerRmHasVolumeFlag(line)) {
      const argv = dockerArgvFromShellLine(line);
      if (!argv || argv[0] !== "rm") continue;
      const targetWord = argv[argv.length - 1]!;
      const resolved = resolveShellWord(targetWord, scalars);
      if (resolved != null && harness.containerNames.includes(resolved)) {
        return true;
      }
    }
  }

  if (harness.composeProject == null) return false;

  for (const line of handlerLines) {
    if (!(/\bdown\s+-v\b/.test(line) || /\bdown\b[^\n]*\s-v\b/.test(line))) {
      continue;
    }
    // Literal -p on the down line (possibly via docker compose …)
    const inline = /-p\s+(\S+)/.exec(line);
    if (inline) {
      const resolved = resolveShellWord(inline[1]!, scalars);
      if (resolved === harness.composeProject) return true;
    }
    // "${compose[@]}" / ${compose[@]} expansion
    const arrUse = /\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}/.exec(line);
    if (arrUse) {
      const tokens = arrays.get(arrUse[1]!);
      if (tokens) {
        const project = resolveComposeProjectFromTokens(tokens, scalars);
        if (project === harness.composeProject) return true;
      }
    }
  }
  return false;
}

/**
 * Harness must trap EXIT INT TERM with a handler that removes the
 * owner-listed project (down -v) or containers (rm -f -v), resolving
 * the target to the owner-listed name. Any docker rm without -v is red.
 */
export function harnessCleanupDefect(
  source: string,
  harness: DockerHarness,
): string | null {
  const lines = shellActiveLines(source);
  const active = lines.join("\n");
  const trap = TRAP_HANDLER_RE.exec(active);
  if (!trap) {
    return "harness lacks trap <fn> EXIT INT TERM";
  }
  const fn = trap[1]!;
  const body = extractShellFunctionBody(source, fn);
  if (body == null) {
    return `harness trap handler ${fn} body not found`;
  }

  for (const line of lines) {
    if (!/\bdocker\s+rm\b/.test(line)) continue;
    if (!dockerRmHasVolumeFlag(line)) {
      return "harness docker rm without -v";
    }
  }

  if (harness.composeProject == null && harness.containerNames.length === 0) {
    return "harness owner lists no compose project or container name";
  }

  if (!handlerRemovesOwnedTarget(body, source, harness)) {
    return "harness trap handler does not remove owner-listed project or containers with -v";
  }
  return null;
}

export function harnessCleanupDefects(
  files: ReadonlyArray<{ path: string; source: string }>,
  owned: readonly DockerOwnedScript[] = DOCKER_OWNED_SCRIPTS,
): string[] {
  const defects: string[] = [];
  for (const h of dockerHarnesses(owned)) {
    const file = files.find((f) => f.path === h.script);
    if (!file) {
      defects.push(`${h.script}: harness source missing`);
      continue;
    }
    const d = harnessCleanupDefect(file.source, h);
    if (d) defects.push(`${h.script}: ${d}`);
  }
  return defects.sort();
}

/** Tokenize a shell `docker …` active line into argv after `docker`. */
export function dockerArgvFromShellLine(line: string): string[] | null {
  const trimmed = line.trim();
  // Skip array assignments like compose=(docker compose -p …)
  if (/^[A-Za-z_][A-Za-z0-9_]*=\(/.test(trimmed)) return null;
  // Match bare, $(docker …), or after ; `|`
  const m = /(?:^|[;`|(\s]|\$\()docker\s+(.+)$/.exec(trimmed);
  if (!m) return null;
  const rest = m[1]!;
  // Rough tokenization: whitespace split, keep quoted segments
  const tokens: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    // Stop at shell operators / closing $(…) outside quotes
    if (
      ch === "|" ||
      ch === ";" ||
      ch === "&" ||
      ch === ">" ||
      ch === "<" ||
      ch === ")"
    ) {
      break;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens.length > 0 ? tokens : null;
}

function argvEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

function isForbiddenPruneArgv(argv: readonly string[]): string | null {
  if (argv[0] === "system" && argv[1] === "prune") {
    return "forbidden docker system prune";
  }
  if (argv[0] === "volume" && argv[1] === "prune") {
    return "forbidden docker volume prune";
  }
  if (argv[0] === "image" && argv[1] === "prune") {
    if (argv.includes("-a") || argv.includes("--all")) {
      return "forbidden docker image prune -a";
    }
  }
  return null;
}

/** True when argv is a removal/prune that must be permitted or forbidden. */
function isRemovalArgv(argv: readonly string[]): boolean {
  if (argv[0] === "system" && argv[1] === "prune") return true;
  if (argv[0] === "volume" && argv[1] === "prune") return true;
  if (argv[0] === "image" && argv[1] === "prune") return true;
  if (argv[0] === "builder" && argv[1] === "prune") return true;
  return false;
}

/** Detect a real docker process spawn in TypeScript source (not comments). */
export function typescriptSpawnsDocker(source: string): boolean {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLine = withoutBlock
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  return (
    /spawnSync\s*\(\s*["']docker["']/.test(withoutLine) ||
    /execFileSync\s*\(\s*["']docker["']/.test(withoutLine) ||
    /execSync\s*\(\s*["']docker["']/.test(withoutLine) ||
    /spawn\s*\(\s*["']docker["']/.test(withoutLine)
  );
}

/**
 * Forbidden prune anywhere; unscoped removals only when argv matches an
 * owner entry for that script. Tracked scripts/*.ts other than docker-clean
 * must not spawn docker.
 */
export function pruneRemovalDefects(
  files: ReadonlyArray<{ path: string; source: string }>,
  permitted: readonly PermittedUnscopedRemoval[] = PERMITTED_UNSCOPED_REMOVALS,
): string[] {
  const defects: string[] = [];
  for (const f of files) {
    if (f.path.startsWith("scripts/") && f.path.endsWith(".ts")) {
      if (f.path !== DOCKER_CLEAN_SCRIPT && typescriptSpawnsDocker(f.source)) {
        defects.push(
          `${f.path}: docker invocation outside ${DOCKER_CLEAN_SCRIPT}`,
        );
      }
    }

    // Shell argv matching only — TypeScript is covered by the spawn check above.
    if (!f.path.endsWith(".sh")) continue;

    const allowed = permittedRemovalsForScript(f.path, permitted);
    for (const line of shellActiveLines(f.source)) {
      const argv = dockerArgvFromShellLine(line);
      if (!argv) continue;
      const forbidden = isForbiddenPruneArgv(argv);
      if (forbidden) {
        defects.push(`${f.path}: ${forbidden}`);
        continue;
      }
      if (!isRemovalArgv(argv)) continue;
      const match = allowed.some((p) => argvEquals(p.argv, argv));
      if (!match) {
        defects.push(
          `${f.path}: unscoped docker ${argv.join(" ")} outside its owning entry`,
        );
      }
    }
  }
  return [...new Set(defects)].sort();
}

/**
 * Build-context form of a .gitignore entry (git anchoring):
 * leading slash → strip; middle slash → keep; leading star-star/ → keep;
 * otherwise prefix star-star/. Negations keep their !.
 */
export function gitignoreToDockerignorePattern(entry: string): string {
  const raw = entry.trim();
  if (!raw || raw.startsWith("#")) {
    throw new Error(`not a gitignore entry: ${entry}`);
  }
  let negated = false;
  let pattern = raw;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }
  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  } else if (pattern.startsWith("**/")) {
    // already git globstar form
  } else if (pattern.includes("/") && !/^[^/]+\/$/.test(pattern)) {
    // middle (or non-trailing-only) slash → anchored at repo root; keep
  } else {
    pattern = `**/${pattern}`;
  }
  return negated ? `!${pattern}` : pattern;
}

/** Non-comment, non-empty .gitignore / .dockerignore entries (order preserved). */
export function ignoreEntries(source: string): string[] {
  return source.split("\n").filter((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("#");
  });
}

/**
 * Owner-listed output directory missing from .gitignore, or live
 * .dockerignore that is not exactly dockerignoreFromGitignore(.gitignore).
 */
export function ignoreSyncDefects(args: {
  gitignore: string;
  dockerignore: string;
  localOutputDirectories?: readonly string[];
}): string[] {
  const localDirs = args.localOutputDirectories ?? LOCAL_OUTPUT_DIRECTORIES;
  const gi = ignoreEntries(args.gitignore);
  const defects: string[] = [];
  for (const dir of localDirs) {
    if (!gi.includes(dir)) {
      defects.push(`local output ${dir} missing from .gitignore`);
    }
  }
  const expected = dockerignoreFromGitignore(args.gitignore);
  if (args.dockerignore !== expected) {
    defects.push(
      ".dockerignore differs from dockerignoreFromGitignore(.gitignore)",
    );
  }
  return defects.sort();
}

/** Build a .dockerignore body from .gitignore (plus .git). */
export function dockerignoreFromGitignore(gitignore: string): string {
  const lines = [
    "# Generated from .gitignore — build context holds tracked files only.",
    "# Extra: .git (not a gitignore entry).",
    "",
  ];
  for (const entry of ignoreEntries(gitignore)) {
    lines.push(gitignoreToDockerignorePattern(entry));
  }
  if (!lines.includes(".git") && !lines.includes("**/.git")) {
    lines.push(".git");
  }
  lines.push("");
  return lines.join("\n");
}

/** Refusal lines for docker:clean when the owner is misconfigured. */
export function dockerCleanRefusal(
  owned: readonly DockerOwnedScript[] = DOCKER_OWNED_SCRIPTS,
): string | null {
  const harnesses = dockerHarnesses(owned);
  if (harnesses.length === 0) {
    return "docker:clean: owner lists no harness";
  }
  const stack = developerStackProject(owned);
  for (const h of harnesses) {
    if (h.composeProject === stack) {
      return `docker:clean: target resolves to developer-stack project ${stack}`;
    }
  }
  return null;
}
