// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ClaimablePayouts} from "./ClaimablePayouts.sol";
import {Mandate} from "./Mandate.sol";
import {Recall} from "./Recall.sol";

/**
 * @title ConsignmentBase
 * @notice Shared consignment automaton, mandate snapshot, recall, settlement split, and payout.
 *
 * @dev Spec: docs/research/commerce-model-2026.md §3.1, §4, §5.1, §6, §8–§9, §13a.5.
 *      Inherits Mandate + Recall + ClaimablePayouts. Does not inherit BondedChallenge
 *      (settlement challenge is ascending/HELD-only). Settlement notes / external confirmation
 *      belong to fixed mode, not here (§4.4).
 *
 *      Carry-ins (model gaps): immutable platformFeeBps + platformRecipient; encumbrance via
 *      virtual `_mayOpenConsignment` until the passport registry ships.
 */
abstract contract ConsignmentBase is Mandate, Recall, ClaimablePayouts, ReentrancyGuard {
    uint256 internal constant _BPS_DENOM = 10_000;

    enum Phase {
        None,
        Offered,
        Closed,
        Returned
    }

    struct Consignment {
        address seller;
        address agent;
        address asset;
        Denomination denomination;
        uint128 floor;
        Compensation compensation;
        uint128 price;
        uint64 openedAt;
    }

    struct SplitResult {
        uint256 platform;
        uint256 ownerAmount;
        uint256 agentAmount;
    }

    address public immutable platformRecipient;
    uint16 public immutable platformFeeBps;

    mapping(uint256 tokenId => Phase) internal _phase;
    mapping(uint256 tokenId => Consignment) internal _consignments;
    /// @dev Ascending BINDING stand-in: live consignment that has left the recall transition set (RC1).
    mapping(uint256 tokenId => bool) internal _committedNotOffered;

    error OpenConsignmentRefused();
    error NotOffered();
    error NotDirectConsignment();
    error BelowFloor();
    error FeeTooHigh();
    error NotConsignmentRunner();

    constructor(address platformRecipient_, uint256 feeBps_) {
        if (platformRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > _BPS_DENOM) revert FeeTooHigh();
        platformRecipient = platformRecipient_;
        platformFeeBps = uint16(feeBps_);
    }

    // ---- Views ----

    function consignmentPhase(uint256 tokenId) public view returns (Phase) {
        return _phase[tokenId];
    }

    function consignmentSellerOf(uint256 tokenId) public view returns (address) {
        return _consignments[tokenId].seller;
    }

    function consignmentAgentOf(uint256 tokenId) public view returns (address) {
        return _consignments[tokenId].agent;
    }

    function consignmentFloorOf(uint256 tokenId) public view returns (uint128) {
        return _consignments[tokenId].floor;
    }

    function consignmentPriceOf(uint256 tokenId) public view returns (uint128) {
        return _consignments[tokenId].price;
    }

    function consignmentOpenedAt(uint256 tokenId) public view returns (uint64) {
        return _consignments[tokenId].openedAt;
    }

    function consignmentCompensationFormOf(uint256 tokenId) public view returns (CompensationForm) {
        return _consignments[tokenId].compensation.form;
    }

    function consignmentCommissionBpsOf(uint256 tokenId) public view returns (uint16) {
        return _consignments[tokenId].compensation.commissionBps;
    }

    function consignmentCommittedNotOffered(uint256 tokenId) public view returns (bool) {
        return _committedNotOffered[tokenId];
    }

    // ---- Opening (N1) ----

    /// @notice Owner opens a direct (unagented) consignment.
    function openDirect(
        uint256 tokenId,
        Denomination calldata denomination,
        address asset,
        uint128 price
    ) external nonReentrant {
        address owner = passportOwner(tokenId);
        if (owner != msg.sender) revert NotPassportOwner();
        _requireCanOpen(tokenId, owner);
        _requirePriceMeetsFloor(price, 0, address(0), Compensation(CompensationForm.Margin, 0));

        _takeCustody(tokenId, owner);
        _writeOpen({
            tokenId: tokenId,
            seller: owner,
            agent: address(0),
            asset: asset,
            denomination: denomination,
            floor: 0,
            compensation: Compensation(CompensationForm.Margin, 0),
            price: price
        });
    }

    /// @notice Mandate agent opens under an active matching mandate (M1/M3).
    function openFromMandate(
        uint256 tokenId,
        Denomination calldata denomination,
        uint128 price
    ) external nonReentrant {
        MandateRecord memory m = _requireMandateAllowsOpen(tokenId, denomination);
        _requireAgentCaller(m.agent);

        address owner = passportOwner(tokenId);
        _requireCanOpen(tokenId, owner);
        _requirePriceMeetsFloor(price, m.floor, m.agent, m.compensation);

        _takeCustody(tokenId, owner);
        _writeOpen({
            tokenId: tokenId,
            seller: owner,
            agent: m.agent,
            asset: m.asset,
            denomination: m.denomination,
            floor: m.floor,
            compensation: m.compensation,
            price: price
        });
    }

    // ---- OFFERED amend (C3 / C6) ----

    /// @notice Whoever runs the sale may move price freely within C6 while OFFERED.
    function setPrice(uint256 tokenId, uint128 newPrice) external nonReentrant {
        _requireOfferedActionable(tokenId);
        Consignment storage c = _consignments[tokenId];
        if (c.agent == address(0)) {
            if (c.seller != msg.sender) revert NotConsignmentSeller();
        } else if (c.agent != msg.sender) {
            revert NotConsignmentRunner();
        }
        _setPrice(tokenId, newPrice);
    }

    // ---- OFFERED exits (O1) ----

    /// @notice Direct seller withdraws immediately. Agented owners use recall (§6).
    function ownerWithdraw(uint256 tokenId) external nonReentrant {
        _requireOfferedActionable(tokenId);
        Consignment storage c = _consignments[tokenId];
        if (c.agent != address(0)) revert NotDirectConsignment();
        if (c.seller != msg.sender) revert NotConsignmentSeller();
        _terminateToOwner(tokenId);
    }

    /// @notice Agent withdraws anytime in OFFERED (including during recall cooldown).
    function agentWithdraw(uint256 tokenId) external nonReentrant {
        _requireOfferedActionable(tokenId);
        _requireAgentCaller(_consignments[tokenId].agent);
        _terminateToOwner(tokenId);
    }

    /// @notice Recipient withdraws a credited claim (PA1).
    function withdrawClaim(address asset) external nonReentrant {
        _withdrawClaim(asset);
    }

    // ---- Split (§5.1 / §13a.5) ----

    /// @dev Arithmetic from the live snapshot. Modes call when funds are ready.
    function _computeSplit(uint256 settledAmount, uint256 tokenId) internal view returns (SplitResult memory) {
        Consignment storage c = _consignments[tokenId];
        return _computeSplitAmounts(settledAmount, c.agent, c.floor, c.compensation);
    }

    /// @dev Pays the split then closes. Caller (mode/harness) must have funded the contract.
    function _paySplit(uint256 tokenId, uint256 settledAmount) internal {
        if (!isLiveConsignment(tokenId)) revert NoLiveConsignment();

        SplitResult memory split = _computeSplit(settledAmount, tokenId);
        Consignment memory c = _consignments[tokenId];
        address asset = c.asset;

        if (asset == address(0)) {
            _payNative(platformRecipient, split.platform);
            _payNative(c.seller, split.ownerAmount);
            if (split.agentAmount != 0) _payNative(c.agent, split.agentAmount);
        } else {
            _payErc20(asset, platformRecipient, split.platform);
            _payErc20(asset, c.seller, split.ownerAmount);
            if (split.agentAmount != 0) _payErc20(asset, c.agent, split.agentAmount);
        }

        _close(tokenId);
    }

    /// @dev Modes/harness mark ascending commit: still live, recall leaves the transition set (RC1).
    function _enterCommittedNotOffered(uint256 tokenId) internal {
        _requireOfferedActionable(tokenId);
        _committedNotOffered[tokenId] = true;
        _clearRecallRequest(tokenId);
    }

    function _setPrice(uint256 tokenId, uint128 newPrice) internal {
        Consignment storage c = _consignments[tokenId];
        _requirePriceMeetsFloor(newPrice, c.floor, c.agent, c.compensation);
        c.price = newPrice;
    }

    function _requireOfferedActionable(uint256 tokenId) private view {
        if (!_isOfferedActionable(tokenId)) revert NotOffered();
    }

    function _isOfferedActionable(uint256 tokenId) private view returns (bool) {
        return _phase[tokenId] == Phase.Offered && !_committedNotOffered[tokenId];
    }

    function _requireAgentCaller(address agent) private view {
        if (agent != msg.sender) revert NotConsignmentAgent();
    }

    /// @dev Single BelowFloor site for open, setPrice, and settle (C6 / §5.1).
    function _computeSplitAmounts(
        uint256 settled,
        address agent,
        uint128 floor,
        Compensation memory comp
    ) private view returns (SplitResult memory) {
        uint256 platform = (settled * platformFeeBps) / _BPS_DENOM;
        uint256 ownerAmount;
        uint256 agentAmount;
        bool ok;

        if (agent == address(0)) {
            ok = settled >= platform;
            if (ok) {
                ownerAmount = settled - platform;
                ok = ownerAmount >= floor;
            }
        } else if (comp.form == CompensationForm.Margin) {
            ok = settled >= platform + uint256(floor);
            if (ok) {
                ownerAmount = floor;
                agentAmount = settled - platform - floor;
            }
        } else {
            agentAmount = (settled * comp.commissionBps) / _BPS_DENOM;
            ok = settled >= platform + agentAmount;
            if (ok) {
                ownerAmount = settled - platform - agentAmount;
                ok = ownerAmount >= floor;
            }
        }

        if (!ok) revert BelowFloor();
        return SplitResult({platform: platform, ownerAmount: ownerAmount, agentAmount: agentAmount});
    }

    // ---- Mandate hooks ----

    function isLiveConsignment(uint256 tokenId) internal view virtual override returns (bool) {
        // Committed-not-offered keeps Phase.Offered; the flag only removes recall/amend transitions.
        return _phase[tokenId] == Phase.Offered;
    }

    function agentOfLiveConsignment(uint256 tokenId) internal view virtual override returns (address) {
        return _consignments[tokenId].agent;
    }

    function snapshotFloor(uint256 tokenId) internal view virtual override returns (uint128) {
        return _consignments[tokenId].floor;
    }

    function snapshotCommissionBps(uint256 tokenId) internal view virtual override returns (uint16) {
        return _consignments[tokenId].compensation.commissionBps;
    }

    function snapshotCompensationForm(uint256 tokenId) internal view virtual override returns (CompensationForm) {
        return _consignments[tokenId].compensation.form;
    }

    function _setSnapshotFloor(uint256 tokenId, uint128 newFloor) internal virtual override {
        _consignments[tokenId].floor = newFloor;
    }

    function _setSnapshotCommissionBps(uint256 tokenId, uint16 newBps) internal virtual override {
        _consignments[tokenId].compensation.commissionBps = newBps;
    }

    // ---- Recall hooks ----

    function isOfferedAgented(uint256 tokenId) internal view virtual override returns (bool) {
        return _isOfferedActionable(tokenId) && _consignments[tokenId].agent != address(0);
    }

    function consignmentSeller(uint256 tokenId) internal view virtual override returns (address) {
        return _consignments[tokenId].seller;
    }

    function _onForceRecall(uint256 tokenId) internal virtual override {
        _terminateToOwner(tokenId);
    }

    // ---- Instance hooks (encumbrance + custody) ----

    function _mayOpenConsignment(uint256 tokenId) internal view virtual returns (bool);

    function _takeCustody(uint256 tokenId, address from) internal virtual;

    function _releaseCustody(uint256 tokenId, address to) internal virtual;

    // ---- Internals ----

    function _requireCanOpen(uint256 tokenId, address owner) private view {
        if (!_mayOpenConsignment(tokenId)) revert OpenConsignmentRefused();
        if (isLiveConsignment(tokenId)) revert LiveConsignment();
        if (!isEscrowApproved(tokenId, owner)) revert EscrowNotApproved();
    }

    function _requirePriceMeetsFloor(
        uint256 price,
        uint128 floor,
        address agent,
        Compensation memory comp
    ) private view {
        _computeSplitAmounts(price, agent, floor, comp);
    }

    function _writeOpen(
        uint256 tokenId,
        address seller,
        address agent,
        address asset,
        Denomination memory denomination,
        uint128 floor,
        Compensation memory compensation,
        uint128 price
    ) private {
        _consignments[tokenId] = Consignment({
            seller: seller,
            agent: agent,
            asset: asset,
            denomination: denomination,
            floor: floor,
            compensation: compensation,
            price: price,
            openedAt: uint64(block.timestamp)
        });
        _committedNotOffered[tokenId] = false;
        _phase[tokenId] = Phase.Offered;
        _clearRecallRequest(tokenId);
    }

    function _terminateToOwner(uint256 tokenId) internal {
        address seller = _consignments[tokenId].seller;
        _clearRecallRequest(tokenId);
        _committedNotOffered[tokenId] = false;
        delete _consignments[tokenId];
        _phase[tokenId] = Phase.Returned;
        _releaseCustody(tokenId, seller);
    }

    function _close(uint256 tokenId) private {
        _clearRecallRequest(tokenId);
        _committedNotOffered[tokenId] = false;
        // Passport already with buyer — modes handle transfer before calling _paySplit.
        // Base clears commercial state only.
        delete _consignments[tokenId];
        _phase[tokenId] = Phase.Closed;
    }
}
