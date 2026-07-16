import next from "eslint-config-next";

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
          paths: [
            {
              name: "lucide-react",
              message:
                "Use @/components/ui/icons (Mono Icons standard, design-spec §7)",
            },
          ],
        },
      ],
      // NS-2: kind:0 NIP-39 ethereum identity tag queries must use the attested
      // profile resolver only — unverified #i reads allow profile spoofing.
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Property[key.value="#i"]',
          message:
            "NIP-39 ethereum identity tag queries must go through lib/nostr/resolve-attested-profile.ts only (profile binding spoofing guard).",
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
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["lib/messaging/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@xmtp/client",
              message:
                "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
            },
          ],
          patterns: [
            {
              group: ["@xmtp/*"],
              message:
                "XMTP SDK may only be imported from lib/messaging/adapters/xmtp-adapter.ts",
            },
          ],
        },
      ],
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
    files: ["lib/messaging/adapters/xmtp-adapter.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["lib/messaging/adapters/cache-adapter.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];

export default eslintConfig;
