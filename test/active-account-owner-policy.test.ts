/**
 * S8-2-fix — active-account entry owns who-is-connected;
 * EVM-shaped members and undefined-field forks are banned outside adapters.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { scanProductSources } from "./policy-scan-helpers.ts";

const EVM_ADAPTER = "lib/web3/evm-account-adapter.ts";
const ENTRY = "hooks/use-active-account.ts";
const VOCAB = "lib/web3/active-account.ts";

const OWNERS = [
  EVM_ADAPTER,
  ENTRY,
  VOCAB,
  "lib/web3/svm-account-adapter.ts",
];

const ACCOUNT_HOOK_IMPORT =
  /\b(?:useAccount|useChainId|useSwitchChain)\b/;

/** Names unique to the removed entry / projection API (never local aliases elsewhere). */
const BANNED_UNIQUE =
  /\b(?:isEvmConnected|switchEvmChain|connectEvm|connectSvm|evmConnector|evmConnectors|svmWallets|evmConnectedAddress|evmConnectedChainId|isEvmAccountConnected|connectedNamespace|SVM_SESSION_NAMESPACE)\b/;

/** Ambiguous identifiers — only illegal when taken from useActiveAccount. */
const BANNED_FROM_ENTRY =
  /\{\s*[^}]*\b(?:evmAddress|evmChainId)\b[^}]*\}\s*=\s*useActiveAccount/;

function accountHookPredicate(rel: string, source: string): string | false {
  if (!ACCOUNT_HOOK_IMPORT.test(source)) return false;
  if (
    /from\s*["']wagmi["']/.test(source) &&
    ACCOUNT_HOOK_IMPORT.test(source)
  ) {
    return `wagmi account hook outside EVM adapter (${rel})`;
  }
  if (
    /\buseAccount\s*\(|\buseChainId\s*\(|\buseSwitchChain\s*\(/.test(source)
  ) {
    return `wagmi account hook call outside EVM adapter (${rel})`;
  }
  return false;
}

function evmShapedMemberPredicate(
  rel: string,
  source: string,
): string | false {
  let check = source;
  if (rel === ENTRY) {
    check = source.replace(/\bevmConnectorLabel\b/g, "");
  }
  if (BANNED_UNIQUE.test(check) || BANNED_FROM_ENTRY.test(check)) {
    return `EVM-shaped active-account member or removed projection (${rel})`;
  }
  return false;
}

/**
 * Call sites that test a removed EVM entry field for undefined / null
 * instead of consuming requireEvmSession / commercialNamespaceOf.
 */
function undefinedFieldForkPredicate(
  rel: string,
  source: string,
): string | false {
  if (/\bisEvmConnected\b/.test(source)) {
    return `EVM-field undefined / isEvmConnected fork outside owners (${rel})`;
  }
  if (
    BANNED_FROM_ENTRY.test(source) &&
    /\bevmAddress\s*[!=]=|\bevmChainId\s*[!=]=|!\s*evmAddress\b|evmAddress\s*&&/.test(
      source,
    )
  ) {
    return `EVM-field undefined fork outside owners (${rel})`;
  }
  return false;
}

describe("active-account owner policy (S8-2-fix)", () => {
  it("no product file outside EVM adapter imports or calls account hooks", () => {
    const violations = scanProductSources(accountHookPredicate, {
      owners: [EVM_ADAPTER],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed dirty component is red", () => {
    const dirty = `
import { useAccount } from "wagmi";
export function Bad() {
  const { address } = useAccount();
  return address;
}
`;
    assert.equal(
      accountHookPredicate("components/invented-account.tsx", dirty),
      "wagmi account hook outside EVM adapter (components/invented-account.tsx)",
    );
  });

  it("constructed dirty hook in previously missed directory is red", () => {
    const dirty = `
import { useChainId } from "wagmi";
export function useBad() {
  return useChainId();
}
`;
    assert.equal(
      accountHookPredicate("hooks/use-invented-chain.ts", dirty),
      "wagmi account hook outside EVM adapter (hooks/use-invented-chain.ts)",
    );
  });

  it("no EVM-shaped entry members or removed projections outside owners", () => {
    const violations = scanProductSources(evmShapedMemberPredicate, {
      owners: OWNERS,
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed EVM-shaped member on a consumer is red", () => {
    const dirty = `
import { useActiveAccount } from "@/hooks/use-active-account";
export function Bad() {
  const { evmAddress, isEvmConnected } = useActiveAccount();
  return isEvmConnected ? evmAddress : null;
}
`;
    assert.equal(
      evmShapedMemberPredicate("components/invented-evm-fields.tsx", dirty),
      "EVM-shaped active-account member or removed projection (components/invented-evm-fields.tsx)",
    );
  });

  it("constructed undefined-field fork is red", () => {
    const dirty = `
export function Bad(isEvmConnected: boolean) {
  if (!isEvmConnected) return null;
  return true;
}
`;
    assert.equal(
      undefinedFieldForkPredicate("components/invented-undef.tsx", dirty),
      "EVM-field undefined / isEvmConnected fork outside owners (components/invented-undef.tsx)",
    );
  });

  it("no undefined-field forks on banned EVM names outside owners", () => {
    const violations = scanProductSources(undefinedFieldForkPredicate, {
      owners: OWNERS,
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("entry surface does not declare removed EVM-shaped members", () => {
    const source = readFileSync(ENTRY, "utf8");
    assert.equal(
      /\bevmAddress\s*:/.test(source),
      false,
      "entry must not declare evmAddress",
    );
    assert.equal(
      /\bisEvmConnected\s*:/.test(source),
      false,
      "entry must not declare isEvmConnected",
    );
    assert.equal(
      /\bconnectEvm\s*:/.test(source),
      false,
      "entry must not declare connectEvm",
    );
    assert.equal(
      /\bsvmWallets\s*:/.test(source),
      false,
      "entry must not declare svmWallets",
    );
  });

  it("product vocabulary has no endpoint-derived SVM_SESSION_NAMESPACE", () => {
    const source = readFileSync(VOCAB, "utf8");
    assert.equal(
      /SVM_SESSION_NAMESPACE|40168/.test(source),
      false,
      "active-account must not invent Devnet namespace from EID 40168",
    );
  });
});
