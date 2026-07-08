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
    files: ["test/**"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];

export default eslintConfig;
