// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Mandate} from "../lib/Mandate.sol";
import {Recall} from "../lib/Recall.sol";

/**
 * @title MandateRecallHarness
 * @notice Minimal consignment stand-in to exercise Mandate + Recall without base commerce logic.
 *
 * @dev Owns only: phase, snapshot fields copied from mandate, owner registry, escrow-approval flag.
 *      No price, settlement, payout, or dual selling modes beyond Binding as a phase flag.
 */
contract MandateRecallHarness is Mandate, Recall {
    enum Phase {
        None,
        Offered,
        Binding,
        Returned
    }

    struct Snapshot {
        address seller;
        address agent;
        address asset;
        Denomination denomination;
        uint128 floor;
        Compensation compensation;
    }

    mapping(uint256 tokenId => Phase) public phase;
    mapping(uint256 tokenId => Snapshot) internal snapshots;
    mapping(uint256 tokenId => address) internal owners;
    mapping(uint256 tokenId => bool) public escrowApproved;

    error NotOffered();
    error AlreadyLive();
    error NotAgent();

    function setPassportOwner(uint256 tokenId, address owner_) external {
        owners[tokenId] = owner_;
    }

    function setEscrowApproved(uint256 tokenId, bool approved) external {
        escrowApproved[tokenId] = approved;
    }

    /// @dev Expose mandate expiry mutation for M1 independence tests (simulates wall-clock / revoke-of-future).
    function forceSetMandateExpiry(uint256 tokenId, uint64 expiry) external {
        mandates[tokenId].expiry = expiry;
    }

    /**
     * @notice Open an OFFERED agented consignment by snapshotting an active matching mandate (M1/M3).
     * @dev No verification gate (M2 lives on grant, not open-from-mandate in this harness).
     */
    function openFromMandate(uint256 tokenId, Denomination calldata openDenomination) external {
        if (phase[tokenId] == Phase.Offered || phase[tokenId] == Phase.Binding) revert AlreadyLive();

        MandateRecord memory m = _requireMandateAllowsOpen(tokenId, openDenomination);

        snapshots[tokenId] = Snapshot({
            seller: passportOwner(tokenId),
            agent: m.agent,
            asset: m.asset,
            denomination: m.denomination,
            floor: m.floor,
            compensation: m.compensation
        });
        phase[tokenId] = Phase.Offered;
        _clearRecallRequest(tokenId);
    }

    /// @notice Ascending commit stand-in: OFFERED → BINDING (RC1 — recall leaves the transition set).
    function enterBinding(uint256 tokenId) external {
        if (phase[tokenId] != Phase.Offered) revert NotOffered();
        phase[tokenId] = Phase.Binding;
        _clearRecallRequest(tokenId);
    }

    /// @notice Agent OFFERED exit — same destination as force recall; not part of Recall library.
    function agentWithdraw(uint256 tokenId) external {
        if (phase[tokenId] != Phase.Offered) revert NotOffered();
        if (snapshots[tokenId].agent != msg.sender) revert NotAgent();
        _terminateToOwner(tokenId);
    }

    // ---- Snapshot reads for tests ----

    function snapshotFloorPublic(uint256 tokenId) external view returns (uint128) {
        return snapshots[tokenId].floor;
    }

    function snapshotCommissionBpsPublic(uint256 tokenId) external view returns (uint16) {
        return snapshots[tokenId].compensation.commissionBps;
    }

    function snapshotCompensationFormPublic(uint256 tokenId) external view returns (CompensationForm) {
        return snapshots[tokenId].compensation.form;
    }

    function snapshotAgent(uint256 tokenId) external view returns (address) {
        return snapshots[tokenId].agent;
    }

    function snapshotSeller(uint256 tokenId) external view returns (address) {
        return snapshots[tokenId].seller;
    }

    // ---- Mandate hooks ----

    function isLiveConsignment(uint256 tokenId) internal view override returns (bool) {
        Phase p = phase[tokenId];
        return p == Phase.Offered || p == Phase.Binding;
    }

    function isEscrowApproved(uint256 tokenId, address) internal view override returns (bool) {
        return escrowApproved[tokenId];
    }

    function passportOwner(uint256 tokenId) internal view override returns (address) {
        return owners[tokenId];
    }

    function agentOfLiveConsignment(uint256 tokenId) internal view override returns (address) {
        return snapshots[tokenId].agent;
    }

    function snapshotFloor(uint256 tokenId) internal view override returns (uint128) {
        return snapshots[tokenId].floor;
    }

    function snapshotCommissionBps(uint256 tokenId) internal view override returns (uint16) {
        return snapshots[tokenId].compensation.commissionBps;
    }

    function snapshotCompensationForm(uint256 tokenId) internal view override returns (CompensationForm) {
        return snapshots[tokenId].compensation.form;
    }

    function _setSnapshotFloor(uint256 tokenId, uint128 newFloor) internal override {
        snapshots[tokenId].floor = newFloor;
    }

    function _setSnapshotCommissionBps(uint256 tokenId, uint16 newBps) internal override {
        snapshots[tokenId].compensation.commissionBps = newBps;
    }

    // ---- Recall hooks ----

    function isOfferedAgented(uint256 tokenId) internal view override returns (bool) {
        return phase[tokenId] == Phase.Offered && snapshots[tokenId].agent != address(0);
    }

    function consignmentSeller(uint256 tokenId) internal view override returns (address) {
        return snapshots[tokenId].seller;
    }

    function _onForceRecall(uint256 tokenId) internal override {
        _terminateToOwner(tokenId);
    }

    function _terminateToOwner(uint256 tokenId) private {
        _clearRecallRequest(tokenId);
        delete snapshots[tokenId];
        phase[tokenId] = Phase.Returned;
    }
}
