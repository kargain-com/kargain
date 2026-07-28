/** Shared ClaimablePayouts surface — identical across Auction / Marketplace / Passport / Staking. */
export const claimablePayoutsAbi = [
  {
    type: "function",
    name: "withdrawClaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pendingClaims",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "ClaimRecorded",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClaimWithdrawn",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
