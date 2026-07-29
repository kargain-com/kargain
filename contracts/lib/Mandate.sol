// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Mandate
 * @notice Owner standing authorisation for one agent over one passport.
 *
 * @dev Spec: docs/research/commerce-model-2026.md §5, §13a.2; invariants M1–M3, C1–C5.
 *      Grant/revoke touch mandate storage. Concessions write the consignment snapshot only.
 */
abstract contract Mandate {
    enum DenominationKind {
        Asset,
        Fiat
    }

    enum CompensationForm {
        Margin,
        Commission
    }

    struct Denomination {
        DenominationKind kind;
        /// @dev Ignored when kind == Asset; currency code when kind == Fiat.
        bytes32 currencyCode;
    }

    struct Compensation {
        CompensationForm form;
        /// @dev Commission bps; must be 0 under Margin.
        uint16 commissionBps;
    }

    struct MandateRecord {
        address agent;
        uint64 expiry;
        address asset;
        Denomination denomination;
        uint128 floor;
        Compensation compensation;
        bool active;
    }

    mapping(uint256 tokenId => MandateRecord) internal mandates;

    error NotPassportOwner();
    error LiveConsignment();
    error NoLiveConsignment();
    error EscrowNotApproved();
    error ZeroAddress();
    error MandateExpired();
    error NoMandate();
    error DenominationMismatch();
    error CannotRaiseFloor();
    error CannotRaiseCommission();
    error NotCommissionForm();
    error NotConsignmentAgent();

    event MandateGranted(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed agent,
        uint64 expiry,
        address asset,
        DenominationKind denominationKind,
        bytes32 currencyCode,
        uint128 floor,
        CompensationForm compensationForm,
        uint16 commissionBps
    );
    event MandateRevoked(uint256 indexed tokenId, address indexed owner, address indexed priorAgent);
    /// @notice Snapshot floor lowered on a live consignment (not the standing mandate).
    event ConsignmentFloorLowered(uint256 indexed tokenId, uint128 newFloor);
    /// @notice Snapshot commission lowered on a live consignment (not the standing mandate).
    event ConsignmentCommissionLowered(uint256 indexed tokenId, uint16 newBps);

    // ---- Views ----

    function mandateAgent(uint256 tokenId) public view returns (address) {
        return mandates[tokenId].agent;
    }

    function mandateExpiry(uint256 tokenId) public view returns (uint64) {
        return mandates[tokenId].expiry;
    }

    function mandateFloor(uint256 tokenId) public view returns (uint128) {
        return mandates[tokenId].floor;
    }

    function mandateActive(uint256 tokenId) public view returns (bool) {
        return mandates[tokenId].active;
    }

    function mandateCompensationForm(uint256 tokenId) public view returns (CompensationForm) {
        return mandates[tokenId].compensation.form;
    }

    function mandateCommissionBps(uint256 tokenId) public view returns (uint16) {
        return mandates[tokenId].compensation.commissionBps;
    }

    function mandateDenominationKind(uint256 tokenId) public view returns (DenominationKind) {
        return mandates[tokenId].denomination.kind;
    }

    function mandateCurrencyCode(uint256 tokenId) public view returns (bytes32) {
        return mandates[tokenId].denomination.currencyCode;
    }

    function mandateAsset(uint256 tokenId) public view returns (address) {
        return mandates[tokenId].asset;
    }

    // ---- Entry points (§13a.2) ----

    function grant(
        uint256 tokenId,
        address agent,
        uint64 expiry,
        address asset,
        Denomination calldata denomination,
        uint128 floor,
        Compensation calldata compensation
    ) external {
        if (passportOwner(tokenId) != msg.sender) revert NotPassportOwner();
        if (isLiveConsignment(tokenId)) revert LiveConsignment();
        if (!isEscrowApproved(tokenId, msg.sender)) revert EscrowNotApproved();
        if (agent == address(0)) revert ZeroAddress();

        Compensation memory comp = compensation;
        if (comp.form == CompensationForm.Margin) {
            comp.commissionBps = 0;
        }

        mandates[tokenId] = MandateRecord({
            agent: agent,
            expiry: expiry,
            asset: asset,
            denomination: denomination,
            floor: floor,
            compensation: comp,
            active: true
        });
        emit MandateGranted(
            tokenId,
            msg.sender,
            agent,
            expiry,
            asset,
            denomination.kind,
            denomination.kind == DenominationKind.Fiat ? denomination.currencyCode : bytes32(0),
            floor,
            comp.form,
            comp.commissionBps
        );
    }

    function revoke(uint256 tokenId) external {
        if (passportOwner(tokenId) != msg.sender) revert NotPassportOwner();
        if (isLiveConsignment(tokenId)) revert LiveConsignment();
        MandateRecord memory m = _requireActiveMandate(tokenId);
        address priorAgent = m.agent;
        delete mandates[tokenId];
        emit MandateRevoked(tokenId, msg.sender, priorAgent);
    }

    /// @notice Owner lowers the floor on the live consignment snapshot (C1). Never touches the mandate.
    function lowerFloor(uint256 tokenId, uint128 newFloor) external {
        if (passportOwner(tokenId) != msg.sender) revert NotPassportOwner();
        if (!isLiveConsignment(tokenId)) revert NoLiveConsignment();

        uint128 current = snapshotFloor(tokenId);
        if (newFloor >= current) revert CannotRaiseFloor();
        _setSnapshotFloor(tokenId, newFloor);
        emit ConsignmentFloorLowered(tokenId, newFloor);
    }

    /// @notice Agent lowers commission bps on the live snapshot (C2). Never touches the mandate.
    function lowerCommission(uint256 tokenId, uint16 newBps) external {
        if (!isLiveConsignment(tokenId)) revert NoLiveConsignment();
        if (agentOfLiveConsignment(tokenId) != msg.sender) revert NotConsignmentAgent();
        if (snapshotCompensationForm(tokenId) != CompensationForm.Commission) {
            revert NotCommissionForm();
        }

        uint16 current = snapshotCommissionBps(tokenId);
        if (newBps >= current) revert CannotRaiseCommission();
        _setSnapshotCommissionBps(tokenId, newBps);
        emit ConsignmentCommissionLowered(tokenId, newBps);
    }

    // ---- Opening helper (M1 / M3) — copies terms; does not open ----

    /**
     * @notice Validates mandate for a new consignment open and returns terms to snapshot.
     * @dev Expiry and denomination apply only at opening. Callers must copy into snapshot.
     */
    function _requireMandateAllowsOpen(
        uint256 tokenId,
        Denomination memory openDenomination
    ) internal view returns (MandateRecord memory m) {
        m = _requireActiveMandate(tokenId);
        if (m.expiry != 0 && block.timestamp >= m.expiry) revert MandateExpired();
        if (!_denominationEq(m.denomination, openDenomination)) revert DenominationMismatch();
    }

    function _requireActiveMandate(uint256 tokenId) internal view returns (MandateRecord memory m) {
        m = mandates[tokenId];
        if (!m.active) revert NoMandate();
    }

    function _denominationEq(Denomination memory a, Denomination memory b) private pure returns (bool) {
        if (a.kind != b.kind) return false;
        if (a.kind == DenominationKind.Asset) return true;
        return a.currencyCode == b.currencyCode;
    }

    // ---- Instance hooks ----

    function isLiveConsignment(uint256 tokenId) internal view virtual returns (bool);

    function isEscrowApproved(uint256 tokenId, address owner) internal view virtual returns (bool);

    function passportOwner(uint256 tokenId) internal view virtual returns (address);

    function agentOfLiveConsignment(uint256 tokenId) internal view virtual returns (address);

    function snapshotFloor(uint256 tokenId) internal view virtual returns (uint128);

    function snapshotCommissionBps(uint256 tokenId) internal view virtual returns (uint16);

    function snapshotCompensationForm(uint256 tokenId) internal view virtual returns (CompensationForm);

    function _setSnapshotFloor(uint256 tokenId, uint128 newFloor) internal virtual;

    function _setSnapshotCommissionBps(uint256 tokenId, uint16 newBps) internal virtual;

    /// @dev Future-safe layout under UUPS children. Used: mandates mapping = 1; reserve to 50.
    uint256[49] private __gap;
}
