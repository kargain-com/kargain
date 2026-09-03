/**
 * Typecheck project registry — every repository TypeScript file belongs to
 * exactly one project's include roots (D-1).
 *
 * Membership is measured via typescript.parseJsonConfigFileContent fileNames
 * (include/exclude after glob), not tsc --listFiles (Program graph).
 * Guard: test/typecheck-project-membership-policy.test.ts
 */

export type TypecheckProject = {
  /** Stable id — do not reuse Truth-layer T# form. */
  id: string;
  /** Path from repo root to the tsconfig for this project. */
  tsconfig: string;
  /** One-line role (runtime / resolution / dependency set). */
  role: string;
};

/**
 * Sole ordered list of typecheck projects. package.json `typecheck` must
 * invoke `tsc --noEmit -p <tsconfig>` for every entry (bidirectional gate).
 */
export const TYPECHECK_PROJECTS: readonly TypecheckProject[] = [
  {
    id: "app",
    tsconfig: "tsconfig.json",
    role: "Next.js application graph (app, components, hooks, lib, types)",
  },
  {
    id: "node",
    tsconfig: "tsconfig.node.json",
    role: "tsx / Hardhat Node tooling (scripts, hardhat.config) — no DOM",
  },
  {
    id: "test",
    tsconfig: "tsconfig.test.json",
    role: "Node test suites that import product modules (DOM + JSX)",
  },
  {
    id: "indexer",
    tsconfig: "tsconfig.indexer.json",
    role: "Ponder indexer + svm-ingest (src, ponder config/schema)",
  },
  {
    id: "svm",
    tsconfig: "svm/tsconfig.json",
    role: "SVM stand + lab host TypeScript (lab node_modules resolution)",
  },
] as const;

export const TYPECHECK_PROJECT_IDS: readonly string[] = TYPECHECK_PROJECTS.map(
  (p) => p.id,
);
