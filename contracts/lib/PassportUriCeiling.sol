// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Declared passport / bridge URI ceiling (UTF-8 byte length).
/// @dev Sole Solidity owner of the literal. Must match
///      `lib/web3/declared-uri-ceiling.ts` and
///      `kargain_errors::PASSPORT_URI_CEILING_BYTES` (policy-tested).
library PassportUriCeiling {
    uint256 internal constant BYTES = 160;
}
