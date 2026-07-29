// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ConsignmentBase} from "../lib/ConsignmentBase.sol";

/**
 * @title ConsignmentBaseHarness
 * @notice Minimal concrete base consumer for split / opening / recall / encumbrance tests.
 *
 * @dev Stubs encumbrance + custody maps. No bidding, HELD window, settlement notes, or BondedChallenge.
 */
contract ConsignmentBaseHarness is ConsignmentBase {
    mapping(uint256 tokenId => address) internal owners;
    mapping(uint256 tokenId => bool) public escrowApproved;
    mapping(uint256 tokenId => bool) public mayOpen;
    mapping(uint256 tokenId => address) public custodyHolder;

    constructor(address platformRecipient_, uint256 feeBps_) ConsignmentBase(platformRecipient_, feeBps_) {}

    receive() external payable {}

    function setPassportOwner(uint256 tokenId, address owner_) external {
        owners[tokenId] = owner_;
    }

    function setEscrowApproved(uint256 tokenId, bool approved) external {
        escrowApproved[tokenId] = approved;
    }

    function setMayOpen(uint256 tokenId, bool allowed) external {
        mayOpen[tokenId] = allowed;
    }

    function forceSetMandateExpiry(uint256 tokenId, uint64 expiry) external {
        mandates[tokenId].expiry = expiry;
    }

    /// @dev RC1 stand-in: live but not OFFERED for recall.
    function enterCommittedNotOffered(uint256 tokenId) external {
        _enterCommittedNotOffered(tokenId);
    }

    function computeSplitPublic(uint256 settledAmount, uint256 tokenId)
        external
        view
        returns (uint256 platform, uint256 ownerAmount, uint256 agentAmount)
    {
        SplitResult memory s = _computeSplit(settledAmount, tokenId);
        return (s.platform, s.ownerAmount, s.agentAmount);
    }

    function paySplitPublic(uint256 tokenId, uint256 settledAmount) external payable nonReentrant {
        _paySplit(tokenId, settledAmount);
    }

    // ---- Mandate / Recall instance hooks ----

    function isEscrowApproved(uint256 tokenId, address) internal view override returns (bool) {
        return escrowApproved[tokenId];
    }

    function passportOwner(uint256 tokenId) internal view override returns (address) {
        return owners[tokenId];
    }

    function _mayOpenConsignment(uint256 tokenId) internal view override returns (bool) {
        return mayOpen[tokenId];
    }

    function _takeCustody(uint256 tokenId, address from) internal override {
        custodyHolder[tokenId] = address(this);
        // from is the passport owner at open; recorded for assertions only.
        from;
    }

    function _releaseCustody(uint256 tokenId, address to) internal override {
        custodyHolder[tokenId] = to;
    }
}
