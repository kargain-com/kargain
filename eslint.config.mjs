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
];

export default eslintConfig;
