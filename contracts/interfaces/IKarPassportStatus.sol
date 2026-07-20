// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal KarPassport status surface for cross-contract guards (e.g. ONFT adapter).
/// @dev Enum layout must stay positionally identical to KarPassport.Status.
interface IKarPassportStatus {
    enum Status {
        UNVERIFIED,
        VERIFIED,
        DISPUTED
    }

    /// @notice Returns the verification lifecycle status for `tokenId`.
    function passportStatus(uint256 tokenId) external view returns (Status);
}
