// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ClaimablePayouts} from "./ClaimablePayouts.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BondedChallenge
 * @notice Native ETH bonded challenge primitive with CH1–CH6 mechanics.
 *
 * @dev Spec source: docs/research/commerce-model-2026.md §7 + §13a.1.
 *      Phase is derived inside the primitive from (openedAt + captured window).
 *      Routing happens inside the primitive; instance handlers run after routing and after state clear.
 */
abstract contract BondedChallenge is ClaimablePayouts, ReentrancyGuard {
    enum JudgeOutcome {
        Upheld,
        Rejected
    }

    struct Challenge {
        uint256 openedAt;
        uint256 windowDuration;
        address challenger;
        uint256 bondAmount;
    }

    mapping(uint256 => Challenge) internal challenges;

    address internal immutable forfeitRecipient;
    uint256 internal immutable bondAmount;
    uint256 internal immutable windowDuration;

    error DisputeActive();
    error NoActiveDispute();
    error NotDisputeOpener();
    error DisputeWindowElapsed();
    error DisputeWindowActive();
    error CannotResolveOwnDispute();
    error WrongValue();
    error NotEligibleChallenger();
    error CannotRouteBondToJudge();

    constructor(address forfeitRecipient_, uint256 bondAmount_, uint256 windowDuration_) {
        require(forfeitRecipient_ != address(0), "forfeitRecipient");
        require(bondAmount_ != 0, "bondAmount");
        require(windowDuration_ != 0, "windowDuration");
        forfeitRecipient = forfeitRecipient_;
        bondAmount = bondAmount_;
        windowDuration = windowDuration_;
    }

    // ---- Views (owned-state introspection for test + derived handlers) ----

    function challengeOpenedAt(uint256 subjectId) public view returns (uint256) {
        return challenges[subjectId].openedAt;
    }

    function challengeWindowDuration(uint256 subjectId) public view returns (uint256) {
        return challenges[subjectId].windowDuration;
    }

    function challengeChallenger(uint256 subjectId) public view returns (address) {
        return challenges[subjectId].challenger;
    }

    function challengeBondAmount(uint256 subjectId) public view returns (uint256) {
        return challenges[subjectId].bondAmount;
    }

    function _isChallengeActive(uint256 subjectId) internal view returns (bool) {
        return challenges[subjectId].openedAt != 0;
    }

    // ---- Entry points (exactly one entrypoint per actor per phase) ----

    function open(uint256 subjectId) public payable nonReentrant virtual {
        _requireNoChallenge(subjectId);
        _requireEligibleChallenger(subjectId, msg.sender);
        _requireBondAmount(msg.value);

        challenges[subjectId] = Challenge({
            openedAt: block.timestamp,
            windowDuration: windowDuration,
            challenger: msg.sender,
            bondAmount: msg.value
        });
    }

    function withdraw(uint256 subjectId) external nonReentrant {
        Challenge memory c = _requireActiveChallenge(subjectId);
        _requireChallenger(c);
        _requireWithinWindow(c);

        // (a) clear state before routing and before terminal handler
        delete challenges[subjectId];

        _payBond(c.challenger, address(0), c.bondAmount);
        _onWithdrawn(subjectId, c.challenger, c.challenger, c.openedAt, c.windowDuration, c.bondAmount);
    }

    function judge(uint256 subjectId, JudgeOutcome outcome) external nonReentrant {
        Challenge memory c = _requireActiveChallenge(subjectId);
        _requireWithinWindow(c);
        _requireNotExcludedJudge(subjectId, c);

        address judgeCaller = msg.sender;
        address bondRecipient = outcome == JudgeOutcome.Upheld ? c.challenger : forfeitRecipient;

        // (a) clear state before routing and before terminal handler
        delete challenges[subjectId];

        _payBond(bondRecipient, judgeCaller, c.bondAmount);

        if (outcome == JudgeOutcome.Upheld) {
            _onUpheld(
                subjectId,
                c.challenger,
                judgeCaller,
                bondRecipient,
                c.openedAt,
                c.windowDuration,
                c.bondAmount
            );
        } else {
            _onRejected(
                subjectId,
                c.challenger,
                judgeCaller,
                bondRecipient,
                c.openedAt,
                c.windowDuration,
                c.bondAmount
            );
        }
    }

    function conclude(uint256 subjectId) external nonReentrant {
        Challenge memory c = _requireActiveChallenge(subjectId);
        _requireAfterWindow(c);

        // (a) clear state before routing and before terminal handler
        delete challenges[subjectId];

        _payBond(forfeitRecipient, address(0), c.bondAmount);
        _onExpired(subjectId, c.challenger, forfeitRecipient, c.openedAt, c.windowDuration, c.bondAmount);
    }

    // ---- Phase checks (single revert sites per error name) ----

    function _requireNoChallenge(uint256 subjectId) internal view {
        if (_isChallengeActive(subjectId)) revert DisputeActive();
    }

    function _requireActiveChallenge(uint256 subjectId) internal view returns (Challenge memory c) {
        c = challenges[subjectId];
        if (c.openedAt == 0) revert NoActiveDispute();
    }

    function _requireEligibleChallenger(uint256 subjectId, address challenger) internal view {
        if (!isEligibleChallenger(subjectId, challenger)) revert NotEligibleChallenger();
    }

    function _requireBondAmount(uint256 amount) internal view {
        if (amount != bondAmount) revert WrongValue();
    }

    function _requireChallenger(Challenge memory c) internal view {
        if (c.challenger != msg.sender) revert NotDisputeOpener();
    }

    function _requireWithinWindow(Challenge memory c) internal view {
        if (block.timestamp >= c.openedAt + c.windowDuration) revert DisputeWindowElapsed();
    }

    function _requireAfterWindow(Challenge memory c) internal view {
        if (block.timestamp < c.openedAt + c.windowDuration) revert DisputeWindowActive();
    }

    function _requireNotExcludedJudge(uint256 subjectId, Challenge memory c) internal view {
        if (isExcludedJudge(subjectId, c.challenger, msg.sender)) revert CannotResolveOwnDispute();
    }

    // ---- Routing ----

    function _payBond(
        address recipient,
        address judgeCaller,
        uint256 amount
    ) internal {
        if (recipient == judgeCaller) revert CannotRouteBondToJudge();
        _payNative(recipient, amount);
    }

    // ---- Instance hooks (four terminal handlers + open eligibility/exclusion set) ----

    function isEligibleChallenger(uint256 subjectId, address challenger) internal view virtual returns (bool);

    function isExcludedJudge(uint256 subjectId, address challenger, address judge) internal view virtual returns (bool);

    function _onUpheld(
        uint256 subjectId,
        address challenger,
        address judgeCaller,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration,
        uint256 bondAmount_
    ) internal virtual;

    function _onRejected(
        uint256 subjectId,
        address challenger,
        address judgeCaller,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration,
        uint256 bondAmount_
    ) internal virtual;

    function _onExpired(
        uint256 subjectId,
        address challenger,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration,
        uint256 bondAmount_
    ) internal virtual;

    function _onWithdrawn(
        uint256 subjectId,
        address challenger,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration,
        uint256 bondAmount_
    ) internal virtual;
}

