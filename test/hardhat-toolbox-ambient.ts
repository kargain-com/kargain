/**
 * Load Hardhat toolbox-viem (+ network-helpers) NetworkConnection
 * augmentations into the test typecheck project. `hardhat.config.ts` lives in
 * the node tooling project; without this import, `connection.viem` /
 * `connection.networkHelpers` are absent from the test graph.
 */
import "@nomicfoundation/hardhat-toolbox-viem";
