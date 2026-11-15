/**
 * Local Docker hygiene (AGENTS.md § Local Docker).
 * Owner: lib/architecture/local-docker.ts
 *
 * Plants are in-memory — never write defects into the scanned tree.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOCKER_CLEAN_SCRIPT,
  DOCKER_OWNED_SCRIPTS,
  LOCAL_OUTPUT_DIRECTORIES,
  PERMITTED_UNSCOPED_REMOVALS,
  dockerCleanRefusal,
  dockerHarnesses,
  dockerScriptClassificationDefects,
  dockerignoreFromGitignore,
  gitignoreToDockerignorePattern,
  harnessCleanupDefect,
  harnessCleanupDefects,
  ignoreSyncDefects,
  pruneRemovalDefects,
  scriptRunsDocker,
  typescriptSpawnsDocker,
  type DockerHarness,
  type DockerOwnedScript,
} from "../lib/architecture/local-docker.ts";
import { listTrackedFiles } from "./policy-content-search.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function trackedShellScripts(): Array<{ path: string; source: string }> {
  const rels = listTrackedFiles(ROOT, ["scripts/*.sh"]).filter(
    (p) => p.startsWith("scripts/") && p.endsWith(".sh"),
  );
  return rels.map((rel) => ({
    path: rel,
    source: readFileSync(path.join(ROOT, rel), "utf8"),
  }));
}

function trackedScriptTs(): Array<{ path: string; source: string }> {
  const rels = listTrackedFiles(ROOT, ["scripts/**/*.ts"]).filter(
    (p) => p.startsWith("scripts/") && p.endsWith(".ts"),
  );
  return rels.map((rel) => ({
    path: rel,
    source: readFileSync(path.join(ROOT, rel), "utf8"),
  }));
}

function pruneScanFiles(): Array<{ path: string; source: string }> {
  return [...trackedShellScripts(), ...trackedScriptTs()];
}

const E2E_HARNESS = DOCKER_OWNED_SCRIPTS.find(
  (s): s is DockerHarness =>
    s.class === "harness" && s.script === "scripts/e2e-local.sh",
)!;

describe("local-docker policy", () => {
  it("1 live: every Docker-trigger script is listed in exactly one class", () => {
    assert.deepEqual(
      dockerScriptClassificationDefects(trackedShellScripts()),
      [],
    );
  });

  it("1 constructed: unlisted docker run script is red then green", () => {
    const plant = {
      path: "scripts/planted-docker.sh",
      source: "#!/bin/bash\ndocker run -d --name x alpine\n",
    };
    const live = trackedShellScripts();
    assert.equal(scriptRunsDocker(plant.source), true);
    assert.deepEqual(
      dockerScriptClassificationDefects([...live, plant]),
      [`${plant.path}: runs Docker but is not listed in the owner`],
    );
    const owned: DockerOwnedScript[] = [
      ...DOCKER_OWNED_SCRIPTS,
      {
        script: plant.path,
        class: "harness",
        composeProject: "kargain-planted",
        containerNames: ["x"],
        imageRepositories: [],
      },
    ];
    assert.deepEqual(
      dockerScriptClassificationDefects([...live, plant], owned),
      [],
    );
  });

  it("2 live: every harness traps EXIT INT TERM and removes owned targets", () => {
    assert.deepEqual(harnessCleanupDefects(trackedShellScripts()), []);
  });

  it("2 constructed: handler removing a differently named container is red then green", () => {
    const live = readFileSync(
      path.join(ROOT, "scripts/e2e-local.sh"),
      "utf8",
    );
    assert.equal(harnessCleanupDefect(live, E2E_HARNESS), null);

    // Cleanup removes a different container; owner name still appears in the file.
    const red = live.replace(
      /docker rm -f -v "\$\{E2E_PG_NAME\}" >\/dev\/null 2>&1 \|\| true\n  fi\n\}/,
      'docker rm -f -v "other-container" >/dev/null 2>&1 || true\n  fi\n}',
    );
    assert.notEqual(red, live);
    assert.match(red, /kargain-e2e-pg/);
    assert.match(red, /docker rm -f -v "other-container"/);
    assert.equal(
      harnessCleanupDefect(red, E2E_HARNESS),
      "harness trap handler does not remove owner-listed project or containers with -v",
    );
    assert.equal(harnessCleanupDefect(live, E2E_HARNESS), null);
  });

  it("3 live: no forbidden prune; unscoped removals only on assigned argv", () => {
    assert.deepEqual(pruneRemovalDefects(pruneScanFiles()), []);
  });

  it("3 constructed: forbidden prune and wrong-owner argv are red then green", () => {
    const systemPrune = {
      path: "scripts/planted-prune.sh",
      source: "#!/bin/bash\ndocker system prune -f\n",
    };
    assert.deepEqual(pruneRemovalDefects([systemPrune]), [
      `${systemPrune.path}: forbidden docker system prune`,
    ]);

    const wrongOwner = {
      path: "scripts/e2e-local.sh",
      source: "#!/bin/bash\ndocker image prune -f\n",
    };
    assert.deepEqual(pruneRemovalDefects([wrongOwner]), [
      `${wrongOwner.path}: unscoped docker image prune -f outside its owning entry`,
    ]);

    const cleanOwner = {
      path: DOCKER_CLEAN_SCRIPT,
      source: 'spawnSync("docker", ["image", "prune", "-f"]);\n',
    };
    // TS docker-clean is allowed to spawn; shell server owns the argv form
    const serverOwner = {
      path: "scripts/ponder-deploy.sh",
      source:
        'docker image prune -f --filter "label=com.kargain.ponder.repository=$repo"\ndocker builder prune -f --filter until=72h\n',
    };
    assert.deepEqual(
      pruneRemovalDefects([cleanOwner, serverOwner], PERMITTED_UNSCOPED_REMOVALS),
      [],
    );

    const otherTs = {
      path: "scripts/lib/planted.ts",
      source: 'spawnSync("docker", ["ps"]);\n',
    };
    assert.equal(typescriptSpawnsDocker(otherTs.source), true);
    assert.deepEqual(pruneRemovalDefects([otherTs]), [
      `${otherTs.path}: docker invocation outside ${DOCKER_CLEAN_SCRIPT}`,
    ]);
  });

  it("4 live: local output dirs in .gitignore; .dockerignore equals generator", () => {
    const gitignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    const dockerignore = readFileSync(path.join(ROOT, ".dockerignore"), "utf8");
    assert.deepEqual(ignoreSyncDefects({ gitignore, dockerignore }), []);
    for (const dir of LOCAL_OUTPUT_DIRECTORIES) {
      assert.ok(
        gitignore.split("\n").includes(dir),
        `${dir} must be a .gitignore entry`,
      );
    }
    assert.equal(dockerignore, dockerignoreFromGitignore(gitignore));
  });

  it("4 constructed: extra dockerignore line is red then green; anchoring cases", () => {
    assert.equal(
      gitignoreToDockerignorePattern("deployments/*.json"),
      "deployments/*.json",
    );
    assert.equal(
      gitignoreToDockerignorePattern("**/.DS_Store"),
      "**/.DS_Store",
    );
    assert.equal(
      gitignoreToDockerignorePattern("node_modules/"),
      "**/node_modules/",
    );
    assert.equal(gitignoreToDockerignorePattern("/docs/*"), "docs/*");
    assert.equal(
      gitignoreToDockerignorePattern("!/docs/README.md"),
      "!docs/README.md",
    );

    const gitignore = [
      "node_modules/",
      ".ponder/",
      ".ponder-deploy/",
      ".vincent-commons/",
      "deployments/*.json",
      "**/.DS_Store",
      "/docs/*",
      "!/docs/README.md",
    ].join("\n");
    const exact = dockerignoreFromGitignore(gitignore);
    assert.deepEqual(
      ignoreSyncDefects({ gitignore, dockerignore: exact }),
      [],
    );

    const withExtra = exact.replace(
      ".git\n",
      ".git\n**/extra-planted/\n",
    );
    assert.notEqual(withExtra, exact);
    assert.deepEqual(
      ignoreSyncDefects({ gitignore, dockerignore: withExtra }),
      [".dockerignore differs from dockerignoreFromGitignore(.gitignore)"],
    );
    assert.deepEqual(
      ignoreSyncDefects({ gitignore, dockerignore: exact }),
      [],
    );

    assert.deepEqual(
      ignoreSyncDefects({
        gitignore: "node_modules/\n",
        dockerignore: dockerignoreFromGitignore("node_modules/\n"),
        localOutputDirectories: [".ponder/"],
      }),
      ["local output .ponder/ missing from .gitignore"],
    );
  });

  it("docker:clean refuses when no harness or target is developer stack", () => {
    assert.equal(dockerCleanRefusal(), null);
    assert.ok(dockerHarnesses().length > 0);

    assert.equal(
      dockerCleanRefusal([]),
      "docker:clean: owner lists no harness",
    );

    const poisoned: DockerOwnedScript[] = [
      {
        script: "scripts/dev-local.sh",
        class: "developer_stack",
        composeProject: "kargain",
      },
      {
        script: "scripts/bad-harness.sh",
        class: "harness",
        composeProject: "kargain",
        containerNames: [],
        imageRepositories: [],
      },
    ];
    assert.equal(
      dockerCleanRefusal(poisoned),
      "docker:clean: target resolves to developer-stack project kargain",
    );
  });
});
