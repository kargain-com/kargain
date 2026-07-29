// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IKarPassportEncumbrance} from "../interfaces/IKarPassportEncumbrance.sol";
import {ConsignmentBase} from "../lib/ConsignmentBase.sol";

/**
 * @title ConsignmentBaseHarness
 * @notice Minimal concrete base consumer for split / opening / recall / encumbrance tests.
 *
 * @dev Stubs encumbrance by Intent + custody maps. No bidding, HELD window, settlement notes, or BondedChallenge.
 */
contract ConsignmentBaseHarness is ConsignmentBase {
    mapping(uint256 tokenId => address) internal owners;
    mapping(uint256 tokenId => bool) public escrowApproved;
    mapping(uint256 tokenId => mapping(IKarPassportEncumbrance.Intent intent => bool)) public mayPermit;
    mapping(uint256 tokenId => address) public custodyHolder;

    constructor(address platformRecipient_, uint256 feeBps_) ConsignmentBase(platformRecipient_, feeBps_) {}

    receive() external payable {}

    function setPassportOwner(uint256 tokenId, address owner_) external {
        owners[tokenId] = owner_;
    }

    function setEscrowApproved(uint256 tokenId, bool approved) external {
        escrowApproved[tokenId] = approved;
    }

    function setMay(uint256 tokenId, IKarPassportEncumbrance.Intent intent, bool allowed) external {
        mayPermit[tokenId][intent] = allowed;
    }

    /// @dev Convenience for OpenConsignment tests (Intent.OpenConsignment = 1).
    function setMayOpen(uint256 tokenId, bool allowed) external {
        mayPermit[tokenId][IKarPassportEncumbrance.Intent.OpenConsignment] = allowed;
    }

    function forceSetMandateExpiry(uint256 tokenId, uint64 expiry) external {
        mandates[tokenId].expiry = expiry;
    }

    /// @dev Test-only: write a non-zero value into the unused floor slot of a *direct* live consignment
    ///      so suites can prove the slot is inert on the direct split. Not on ConsignmentBase —
    ///      modes never inherit this harness.
    function forceSetConsignmentFloor(uint256 tokenId, uint128 floor_) external {
        require(isLiveConsignment(tokenId), "not live");
        require(_consignments[tokenId].agent == address(0), "not direct");
        _consignments[tokenId].floor = floor_;
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

    function _may(uint256 tokenId, IKarPassportEncumbrance.Intent intent) internal view override returns (bool) {
        return mayPermit[tokenId][intent];
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
