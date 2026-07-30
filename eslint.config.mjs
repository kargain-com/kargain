import next from "eslint-config-next";

const restrictedSdkPaths = [
  {
    name: "lucide-react",
    message:
      "Use @/components/ui/icons (Mono Icons standard, design-spec §7)",
  },
  {
    name: "@xmtp/client",
    message:
      "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
  },
];

const restrictedReceiptPaths = [
  {
    name: "wagmi/actions",
    importNames: ["waitForTransactionReceipt"],
    message:
      "Use useTxSync: runTx for final writes or awaitReceipt for prerequisites.",
  },
  {
    name: "@wagmi/core",
    importNames: ["waitForTransactionReceipt"],
    message:
      "Use useTxSync: runTx for final writes or awaitReceipt for prerequisites.",
  },
  {
    name: "wagmi",
    importNames: ["useWaitForTransactionReceipt"],
    message:
      "Use useTxSync: runTx for final writes or awaitReceipt for prerequisites.",
  },
];

const eslintConfig = [
  ...next,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "artifacts/**",
      "cache/**",
      "contracts/**",
      "old-*/**",
      "lib/contracts/abis.generated.ts",
    ],
  },
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...restrictedSdkPaths, ...restrictedReceiptPaths],
          patterns: [
            {
              group: ["@xmtp/*"],
              message:
                "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
            },
            {
              group: ["@layerzerolabs/*"],
              message:
                "LayerZero SDK may only be imported from lib/web3/bridge/ (bridge adapter boundary)",
            },
          ],
        },
      ],
      // Native <img> is intentional: Arweave/gateway covers, ENS/Nostr avatars,
      // data-URL QR plates, chain icons, and Satori OG (ImageResponse) cannot
      // use next/image without remote allowlists and layout changes. Brand
      // chrome uses CSS mask (KargainLogo), not next/image. Do not re-add
      // per-file eslint-disable for this rule.
      "@next/next/no-img-element": "off",
      // NS-2: kind:0 NIP-39 ethereum identity tag queries must use the attested
      // profile resolver only — unverified #i reads allow profile spoofing.
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Property[key.value="#i"]',
          message:
            "NIP-39 ethereum identity tag queries must go through lib/nostr/resolve-attested-profile.ts only (profile binding spoofing guard).",
        },
        {
          selector: "Identifier[name='DEFAULT_CHAIN_ID']",
          message:
            "Silent hub DEFAULT_CHAIN_ID is banned — use lib/web3/chain-context.ts roles (custody / wallet commercial / commercial union / fxRateChainId / storageEnvChainId).",
        },
        {
          selector: "Literal[value=/photon\\.komoot\\.io/]",
          message:
            "Photon host may only appear in lib/geo/photon-config.ts or lib/geo/adapters/** — use PlaceDirectory /api/geo proxy.",
        },
        {
          selector: "TemplateElement[value.raw=/photon\\.komoot\\.io/]",
          message:
            "Photon host may only appear in lib/geo/photon-config.ts or lib/geo/adapters/** — use PlaceDirectory /api/geo proxy.",
        },
      ],
    },
  },
  {
    // Public Photon default URL + sole HTTP adapter (geo choke-point).
    files: [
      "lib/geo/photon-config.ts",
      "lib/geo/adapters/**",
      "test/geo-*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["hooks/use-tx-sync.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedSdkPaths,
          patterns: [
            {
              group: ["@xmtp/*"],
              message:
                "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
            },
            {
              group: ["@layerzerolabs/*"],
              message:
                "LayerZero SDK may only be imported from lib/web3/bridge/ (bridge adapter boundary)",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/nostr/resolve-attested-profile.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // kind 30405 passport tag on listing offers — not profile binding.
    files: ["lib/nostr/listing-offers.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["test/**", "scripts/**"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["lib/messaging/adapters/xmtp-adapter.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            restrictedSdkPaths[0],
            ...restrictedReceiptPaths,
          ],
          patterns: [
            {
              group: ["@layerzerolabs/*"],
              message:
                "LayerZero SDK may only be imported from lib/web3/bridge/ (bridge adapter boundary)",
            },
          ],
        },
      ],
    },
  },
  {
    // Bridge adapter boundary (§7.6) — LZ SDK only here (dir may be empty until wiring).
    files: ["lib/web3/bridge/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...restrictedSdkPaths, ...restrictedReceiptPaths],
          patterns: [
            {
              group: ["@xmtp/*"],
              message:
                "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
            },
          ],
        },
      ],
    },
  },
  {
    // Hardhat bridge suite uses LZ Options + EndpointV2Mock artifact resolve.
    // Pathway tooling (§7.6 config scripts) may import LZ Options / protocol ABIs.
    files: [
      "test/KarPassportBridgeGateway.test.ts",
      "test/layerzero-pathway.test.ts",
      "scripts/lib/layerzero-pathway.ts",
      "scripts/bridge-wire.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...restrictedSdkPaths, ...restrictedReceiptPaths],
          patterns: [
            {
              group: ["@xmtp/*"],
              message:
                "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/messaging/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='localStorage']",
          message:
            "localStorage may only be accessed from lib/messaging/adapters/cache-adapter.ts",
        },
        {
          selector:
            "CallExpression[callee.object.name='localStorage']",
          message:
            "localStorage may only be accessed from lib/messaging/adapters/cache-adapter.ts",
        },
      ],
    },
  },
  {
    files: ["lib/messaging/adapters/cache-adapter.ts", "lib/messaging/last-seen.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];

export default eslintConfig;
