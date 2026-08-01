// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {IKarPassportEncumbrance} from "../interfaces/IKarPassportEncumbrance.sol";
import {ClaimablePayouts} from "./ClaimablePayouts.sol";
import {Mandate} from "./Mandate.sol";
import {Recall} from "./Recall.sol";

/**
 * @title ConsignmentBase
 * @notice Shared consignment automaton, mandate snapshot, recall, settlement split, and payout.
 *
 * @dev Spec: docs/research/commerce-model-2026.md §3.1, §4, §5.1, §6, §8–§9, §11 G3, §13a.5.
 *      Inherits Mandate + Recall + ClaimablePayouts + OwnableUpgradeable. Does not inherit BondedChallenge
 *      (settlement challenge is ascending/HELD-only). Settlement notes / external confirmation
 *      belong to fixed mode, not here (§4.4).
 *
 *      G3: operations that only reduce exposure are immediate (guardian); operations that expand
 *      or restore exposure wait (owner / timelock). Guardian pauses and may revoke payment tokens;
 *      owner alone unpauses, approves tokens, and replaces the guardian. Pause gates opening only
 *      on this base; modes gate bid/buy themselves. Settlement, claims, recall, challenge never pause.
 */
abstract contract ConsignmentBase is Mandate, Recall, ClaimablePayouts, ReentrancyGuard, OwnableUpgradeable {
    uint256 internal constant _BPS_DENOM = 10_000;

    enum Phase {
        None,
        Offered,
        Closed,
        Returned
    }

    /// @notice Why a consignment left the live set. Reconstructable without storage.
    enum CloseReason {
        Returned,
        Sold,
        ExternalConfirmed,
        HoldReleased,
        Recalled,
        ReversalCompleted,
        ReversalAbandoned
    }

    struct Consignment {
        address seller;
        address agent;
        address asset;
        Denomination denomination;
        /// @dev Meaningful only when `agent != 0`. Ignored for direct consignments.
        uint128 floor;
        Compensation compensation;
        /// @dev Platform fee bps frozen at open (G1). Packs with floor+compensation in slot 5.
        uint16 platformFeeBps;
        uint128 price;
        uint64 openedAt;
    }

    struct SplitResult {
        uint256 platform;
        uint256 ownerAmount;
        uint256 agentAmount;
    }

    address public platformRecipient;
    uint16 public platformFeeBps;

    mapping(uint256 tokenId => Phase) internal _phase;
    mapping(uint256 tokenId => Consignment) internal _consignments;
    /// @dev Ascending BINDING stand-in: live consignment that has left the recall transition set (RC1).
    mapping(uint256 tokenId => bool) internal _committedNotOffered;

    bool public paused;
    address public guardian;

    error OpenConsignmentRefused();
    error ModeNotEncumbranceSource();
    error NotOffered();
    error NotDirectConsignment();
    error BelowFloor();
    error FeeTooHigh();
    error NotConsignmentRunner();
    error ContractPaused();
    error NotGuardian();
    /// @dev Caller is neither the guardian nor the owner (e.g. soft-revoke).
    error NotGuardianOrOwner();

    event Paused(address account);
    event Unpaused(address account);
    event GuardianSet(address indexed previous, address indexed current);
    event ConsignmentOpened(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed agent,
        address asset,
        DenominationKind denominationKind,
        bytes32 currencyCode,
        uint128 floor,
        CompensationForm compensationForm,
        uint16 commissionBps,
        uint128 price,
        uint16 platformFeeBps,
        uint64 openedAt
    );
    event ConsignmentPriceSet(uint256 indexed tokenId, address indexed setter, uint128 newPrice);
    event ConsignmentClosed(uint256 indexed tokenId, CloseReason reason);
    event ConsignmentSplitPaid(
        uint256 indexed tokenId,
        address indexed asset,
        address ownerRecipient,
        uint256 ownerAmount,
        address agentRecipient,
        uint256 agentAmount,
        address platformRecipient,
        uint256 platformAmount
    );

    /// @dev Used: platformRecipient, platformFeeBps, _phase, _consignments, _committedNotOffered, paused, guardian = 7.
    ///      Reserve to 50 for this contract's namespace (ClaimablePayouts / Mandate / Recall own their gaps).
    uint256[43] private __gap;

    function __ConsignmentBase_init(
        address platformRecipient_,
        uint256 feeBps_,
        address initialOwner_,
        address guardian_
    ) internal onlyInitializing {
        __Ownable_init(initialOwner_);
        __ConsignmentBase_init_unchained(platformRecipient_, feeBps_, guardian_);
    }

    function __ConsignmentBase_init_unchained(
        address platformRecipient_,
        uint256 feeBps_,
        address guardian_
    ) internal onlyInitializing {
        _configureCommerce(platformRecipient_, feeBps_, guardian_);
    }

    function _configureCommerce(address platformRecipient_, uint256 feeBps_, address guardian_) private {
        if (platformRecipient_ == address(0) || guardian_ == address(0)) revert ZeroAddress();
        if (feeBps_ > _BPS_DENOM) revert FeeTooHigh();
        platformRecipient = platformRecipient_;
        platformFeeBps = uint16(feeBps_);
        guardian = guardian_;
    }

    // ---- G3 pause ----

    function pause() external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        address previous = guardian;
        guardian = newGuardian;
        emit GuardianSet(previous, newGuardian);
    }

    function _requireNotPaused() internal view {
        if (paused) revert ContractPaused();
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

    /// @notice Owner opens a direct (unagented) consignment. No floor — seller sets price freely.
    function openDirect(
        uint256 tokenId,
        Denomination calldata denomination,
        address asset,
        uint128 price
    ) external virtual nonReentrant {
        _requireNotPaused();
        address owner_ = passportOwner(tokenId);
        if (owner_ != msg.sender) revert NotPassportOwner();
        _requireModeOpen(tokenId, owner_, denomination, asset);
        _requireCanOpen(tokenId, owner_);

        _takeCustody(tokenId, owner_);
        _writeOpen({
            tokenId: tokenId,
            seller: owner_,
            agent: address(0),
            asset: asset,
            denomination: denomination,
            floor: 0, // unused storage slot; direct path never consults floor
            compensation: Compensation(CompensationForm.Margin, 0),
            price: price
        });
    }

    /// @notice Mandate agent opens under an active matching mandate (M1/M3).
    function openFromMandate(
        uint256 tokenId,
        Denomination calldata denomination,
        uint128 price
    ) external virtual nonReentrant {
        _requireNotPaused();
        MandateRecord memory m = _requireMandateAllowsOpen(tokenId, denomination);
        _requireAgentCaller(m.agent);

        address owner_ = passportOwner(tokenId);
        _requireModeOpen(tokenId, m.agent, denomination, m.asset);
        _requireCanOpen(tokenId, owner_);
        _requireAgentedPriceMeetsFloor(price, m.floor, m.compensation, platformFeeBps);

        _takeCustody(tokenId, owner_);
        _writeOpen({
            tokenId: tokenId,
            seller: owner_,
            agent: m.agent,
            asset: m.asset,
            denomination: m.denomination,
            floor: m.floor,
            compensation: m.compensation,
            price: price
        });
    }

    // ---- OFFERED amend (C3 / C6) ----

    /// @notice Whoever runs the sale may move price while OFFERED. Agented paths enforce C6.
    function setPrice(uint256 tokenId, uint128 newPrice) external virtual nonReentrant {
        _requireModeSetPrice(tokenId);
        _requireOfferedActionable(tokenId);
        Consignment storage c = _consignments[tokenId];
        if (c.agent == address(0)) {
            if (c.seller != msg.sender) revert NotConsignmentSeller();
            c.price = newPrice;
            emit ConsignmentPriceSet(tokenId, msg.sender, newPrice);
            return;
        }
        if (c.agent != msg.sender) revert NotConsignmentRunner();
        _requireAgentedPriceMeetsFloor(newPrice, c.floor, c.compensation, c.platformFeeBps);
        c.price = newPrice;
        emit ConsignmentPriceSet(tokenId, msg.sender, newPrice);
    }

    // ---- OFFERED exits (O1) ----

    /// @notice Direct seller withdraws immediately. Agented owners use recall (§6).
    function ownerWithdraw(uint256 tokenId) external nonReentrant {
        _requireOfferedActionable(tokenId);
        Consignment storage c = _consignments[tokenId];
        if (c.agent != address(0)) revert NotDirectConsignment();
        if (c.seller != msg.sender) revert NotConsignmentSeller();
        _terminateToOwner(tokenId, CloseReason.Returned);
    }

    /// @notice Agent withdraws anytime in OFFERED (including during recall cooldown).
    function agentWithdraw(uint256 tokenId) external nonReentrant {
        _requireOfferedActionable(tokenId);
        _requireAgentCaller(_consignments[tokenId].agent);
        _terminateToOwner(tokenId, CloseReason.Returned);
    }

    /// @notice Recipient withdraws a credited claim (PA1).
    function withdrawClaim(address asset) external nonReentrant {
        _withdrawClaim(asset);
    }

    // ---- Split (§5.1 / §13a.5) ----

    /// @dev Arithmetic from the open-time fee snapshot. Modes call when funds are ready.
    function _computeSplit(uint256 settledAmount, uint256 tokenId) internal view returns (SplitResult memory) {
        Consignment storage c = _consignments[tokenId];
        if (c.agent == address(0)) {
            return _computeDirectSplit(settledAmount, c.platformFeeBps);
        }
        return _computeAgentedSplitAmounts(settledAmount, c.floor, c.compensation, c.platformFeeBps);
    }

    /// @dev Direct: platform share then owner remainder. No floor.
    function _computeDirectSplit(uint256 settled, uint16 feeBps) private pure returns (SplitResult memory) {
        uint256 platform = (settled * feeBps) / _BPS_DENOM;
        return SplitResult({platform: platform, ownerAmount: settled - platform, agentAmount: 0});
    }

    /// @dev Pays the split then closes. Caller (mode/harness) must have funded the contract.
    function _paySplit(uint256 tokenId, uint256 settledAmount, CloseReason reason) internal {
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

        emit ConsignmentSplitPaid(
            tokenId,
            asset,
            c.seller,
            split.ownerAmount,
            c.agent,
            split.agentAmount,
            platformRecipient,
            split.platform
        );
        _close(tokenId, reason);
    }

    /// @dev Modes/harness mark ascending commit: still live, recall leaves the transition set (RC1).
    function _enterCommittedNotOffered(uint256 tokenId) internal {
        _requireOfferedActionable(tokenId);
        _committedNotOffered[tokenId] = true;
        _clearRecallRequest(tokenId);
    }

    function _requireOfferedActionable(uint256 tokenId) internal view {
        if (!_isOfferedActionable(tokenId)) revert NotOffered();
    }

    function _isOfferedActionable(uint256 tokenId) internal view returns (bool) {
        return _phase[tokenId] == Phase.Offered && !_committedNotOffered[tokenId];
    }

    function _requireAgentCaller(address agent) internal view {
        if (agent != msg.sender) revert NotConsignmentAgent();
    }

    /// @dev Single BelowFloor site for agented open, setPrice, and settle (C6 / §5.1).
    /// Commission: platform takes a floored first cut; owner is one floored fraction of
    /// settled (monotonic in S — S32); agent takes the residual (truncation dust).
    function _computeAgentedSplitAmounts(
        uint256 settled,
        uint128 floor,
        Compensation memory comp,
        uint16 feeBps
    ) internal pure returns (SplitResult memory) {
        uint256 platform = (settled * feeBps) / _BPS_DENOM;
        uint256 ownerAmount;
        uint256 agentAmount;
        bool ok;

        if (comp.form == CompensationForm.Margin) {
            ok = settled >= platform + uint256(floor);
            if (ok) {
                ownerAmount = floor;
                agentAmount = settled - platform - floor;
            }
        } else {
            uint256 cutBps = uint256(feeBps) + uint256(comp.commissionBps);
            ownerAmount = cutBps >= _BPS_DENOM
                ? 0
                : (settled * (_BPS_DENOM - cutBps)) / _BPS_DENOM;
            ok = settled >= platform + ownerAmount;
            if (ok) {
                agentAmount = settled - platform - ownerAmount;
                ok = ownerAmount >= floor;
            }
        }

        if (!ok) revert BelowFloor();
        return SplitResult({platform: platform, ownerAmount: ownerAmount, agentAmount: agentAmount});
    }

    function _requireAgentedPriceMeetsFloor(
        uint256 price,
        uint128 floor,
        Compensation memory comp,
        uint16 feeBps
    ) internal pure {
        _computeAgentedSplitAmounts(price, floor, comp, feeBps);
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
        _terminateToOwner(tokenId, CloseReason.Recalled);
    }

    // ---- Instance hooks (encumbrance + custody) ----

    /// @dev Passport permission for a named intent (E0). Production calls IKarPassportEncumbrance.may.
    function _may(uint256 tokenId, IKarPassportEncumbrance.Intent intent) internal view virtual returns (bool);

    /// @dev Live registry membership for this mode. Registration can be revoked — never cache.
    function _isSelfEncumbranceSource() internal view virtual returns (bool);

    function _takeCustody(uint256 tokenId, address from) internal virtual;

    function _releaseCustody(uint256 tokenId, address to) internal virtual;

    /// @dev Mode-specific opening gates (ascending N2/N4; FixedPrice payment admission).
    function _requireModeOpen(
        uint256 tokenId,
        address runner,
        Denomination memory denomination,
        address asset
    ) internal view virtual {}

    /// @dev Mode-specific price-amend gate (ascending C4 refuses). FixedPrice leaves no-op.
    function _requireModeSetPrice(uint256 tokenId) internal view virtual {}

    // ---- Internals ----

    /// @dev Internal so ascending can open with a duration term the base signature does not carry.
    ///      Registration is checked here (shared by both modes and both mandate kinds) so an
    ///      unregistered mode cannot open while LeaveChain would be blind to its live lots.
    function _requireCanOpen(uint256 tokenId, address owner_) internal view {
        if (!_isSelfEncumbranceSource()) revert ModeNotEncumbranceSource();
        if (!_may(tokenId, IKarPassportEncumbrance.Intent.OpenConsignment)) revert OpenConsignmentRefused();
        if (isLiveConsignment(tokenId)) revert LiveConsignment();
        if (!isEscrowApproved(tokenId, owner_)) revert EscrowNotApproved();
    }

    /// @dev Internal so ascending can open with a duration term the base signature does not carry.
    function _writeOpen(
        uint256 tokenId,
        address seller,
        address agent,
        address asset,
        Denomination memory denomination,
        uint128 floor,
        Compensation memory compensation,
        uint128 price
    ) internal {
        uint64 openedAt = uint64(block.timestamp);
        uint16 feeBps = platformFeeBps;
        _consignments[tokenId] = Consignment({
            seller: seller,
            agent: agent,
            asset: asset,
            denomination: denomination,
            floor: floor,
            compensation: compensation,
            platformFeeBps: feeBps,
            price: price,
            openedAt: openedAt
        });
        _committedNotOffered[tokenId] = false;
        _phase[tokenId] = Phase.Offered;
        _clearRecallRequest(tokenId);
        emit ConsignmentOpened(
            tokenId,
            seller,
            agent,
            asset,
            denomination.kind,
            denomination.kind == DenominationKind.Fiat ? denomination.currencyCode : bytes32(0),
            floor,
            compensation.form,
            compensation.commissionBps,
            price,
            feeBps,
            openedAt
        );
    }

    function _terminateToOwner(uint256 tokenId, CloseReason reason) internal {
        address seller = _consignments[tokenId].seller;
        _clearRecallRequest(tokenId);
        _committedNotOffered[tokenId] = false;
        delete _consignments[tokenId];
        _phase[tokenId] = Phase.Returned;
        _releaseCustody(tokenId, seller);
        emit ConsignmentClosed(tokenId, reason);
    }

    /// @dev Modes transfer the passport to the buyer first, then call this (or `_paySplit` which calls it).
    function _close(uint256 tokenId, CloseReason reason) internal {
        _clearRecallRequest(tokenId);
        _committedNotOffered[tokenId] = false;
        // Passport already with buyer — modes handle transfer before calling _paySplit / external close.
        // Base clears commercial state only.
        delete _consignments[tokenId];
        _phase[tokenId] = Phase.Closed;
        emit ConsignmentClosed(tokenId, reason);
    }
}
