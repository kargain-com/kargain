// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BondedChallenge} from "../lib/BondedChallenge.sol";

contract RejectETH {
    // Mirror BondedChallenge error to help viem decode when the revert bubbles through this helper.
    error CannotRouteBondToJudge();

    receive() external payable {
        revert("RejectETH");
    }

    function callJudge(
        address challenge,
        uint256 subjectId,
        BondedChallenge.JudgeOutcome outcome
    ) external {
        BondedChallenge(challenge).judge(subjectId, outcome);
    }
}

contract BondedChallengeInstanceVerificationHarness is BondedChallenge {
    uint8 private constant UNVERIFIED = 0;
    uint8 private constant VERIFIED = 1;
    uint8 private constant DISPUTED = 2;

    address public immutable owner;
    address public immutable challengedVerifier;
    uint256 private immutable _bondAmount;

    mapping(uint256 => uint8) public passportStatus;
    mapping(uint256 => uint8) public lastTerminalKind;

    enum TerminalKind {
        Upheld,
        Rejected,
        Expired,
        Withdrawn
    }

    bool public checkOrdering;
    bool public revertEnabled;
    TerminalKind public revertTerminal;

    /// @dev When true (default), every address is qualified. When false, only `individuallyQualified`.
    bool public qualifyAll = true;
    mapping(address account => bool) public individuallyQualified;

    error OrderingViolation();
    error HandlerReverted();

    constructor(
        address owner_,
        address challengedVerifier_,
        address forfeitRecipient_,
        uint256 bondAmount_,
        uint256 windowDuration_
    ) {
        require(bondAmount_ != 0, "bondAmount");
        _configureBondedChallenge(forfeitRecipient_, windowDuration_);
        owner = owner_;
        challengedVerifier = challengedVerifier_;
        _bondAmount = bondAmount_;
    }

    function setCheckOrdering(bool enabled) external {
        checkOrdering = enabled;
    }

    function setQualifyAll(bool enabled) external {
        qualifyAll = enabled;
    }

    function setQualified(address account, bool enabled) external {
        individuallyQualified[account] = enabled;
    }

    function setRevertTerminal(TerminalKind kind, bool enabled) external {
        revertEnabled = enabled;
        revertTerminal = kind;
    }

    function open(uint256 subjectId) public payable override {
        super.open(subjectId);
        passportStatus[subjectId] = DISPUTED;
        lastTerminalKind[subjectId] = 0;
    }

    // --- BondedChallenge instance hooks ---

    function isEligibleChallenger(uint256, address) internal pure override returns (bool) {
        return true;
    }

    function _requiredBondAmount() internal view override returns (uint256) {
        return _bondAmount;
    }

    function isQualifiedJudge(uint256, address judge) internal view override returns (bool) {
        if (qualifyAll) return true;
        return individuallyQualified[judge];
    }

    function isExcludedJudge(uint256, address challenger, address judge)
        internal
        view
        override
        returns (bool)
    {
        return judge == challenger || judge == owner || judge == challengedVerifier;
    }

    function _maybeCheckOrdering(
        uint256 subjectId,
        address bondRecipient,
        uint256 bondAmount_
    ) internal view {
        if (!checkOrdering) return;

        if (challenges[subjectId].openedAt != 0) revert OrderingViolation();

        // Ordering obligation: routing precedes terminal handler.
        if (pendingClaims(bondRecipient, address(0)) != bondAmount_) revert OrderingViolation();
    }

    function _maybeRevertAfterChecks(TerminalKind kind) internal view {
        if (!revertEnabled) return;
        if (revertTerminal == kind) revert HandlerReverted();
    }

    function _onUpheld(
        uint256 subjectId,
        address /*challenger*/,
        address /*judgeCaller*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Upheld);

        // Verification instance: upheld means verification lapses (UNVERIFIED).
        passportStatus[subjectId] = UNVERIFIED;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Upheld);

        // Silence unused param warnings; handlers can observe captured window if needed.
        openedAt;
        windowDuration_;
    }

    function _onRejected(
        uint256 subjectId,
        address /*challenger*/,
        address /*judgeCaller*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Rejected);

        // Verification instance: rejected means verification stands (VERIFIED).
        passportStatus[subjectId] = VERIFIED;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Rejected);

        openedAt;
        windowDuration_;
    }

    function _onExpired(
        uint256 subjectId,
        address /*challenger*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Expired);

        // Verification instance: expired means verification lapses (UNVERIFIED).
        passportStatus[subjectId] = UNVERIFIED;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Expired);

        openedAt;
        windowDuration_;
    }

    function _onWithdrawn(
        uint256 subjectId,
        address /*challenger*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Withdrawn);

        // Withdrawal restores what the challenge suspended: verification stands (VERIFIED).
        passportStatus[subjectId] = VERIFIED;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Withdrawn);

        openedAt;
        windowDuration_;
    }
}

contract BondedChallengeInstanceSettlementHarness is BondedChallenge {
    address public immutable buyer;
    address public immutable seller;
    address public immutable agent;
    uint256 public immutable abandonmentWindowDuration;
    uint256 private immutable _bondAmount;

    // Domain simulation for CH3/CH4/CH5/CH6.
    mapping(uint256 => uint256) public protectionEndsAt;
    mapping(uint256 => bool) public reversalPending;
    mapping(uint256 => uint256) public abandonmentDeadline;
    mapping(uint256 => bool) public sellerPaid;

    mapping(uint256 => uint8) public lastTerminalKind;

    enum TerminalKind {
        Upheld,
        Rejected,
        Expired,
        Withdrawn
    }

    bool public checkOrdering;
    bool public revertEnabled;
    TerminalKind public revertTerminal;

    error OrderingViolation();
    error HandlerReverted();

    constructor(
        address buyer_,
        address seller_,
        address agent_,
        address forfeitRecipient_,
        uint256 bondAmount_,
        uint256 windowDuration_,
        uint256 abandonmentWindowDuration_
    ) {
        require(bondAmount_ != 0, "bondAmount");
        _configureBondedChallenge(forfeitRecipient_, windowDuration_);
        buyer = buyer_;
        seller = seller_;
        agent = agent_;
        abandonmentWindowDuration = abandonmentWindowDuration_;
        _bondAmount = bondAmount_;
    }

    function setCheckOrdering(bool enabled) external {
        checkOrdering = enabled;
    }

    function setRevertTerminal(TerminalKind kind, bool enabled) external {
        revertEnabled = enabled;
        revertTerminal = kind;
    }

    function open(uint256 subjectId) public payable override {
        super.open(subjectId);

        // Challenge freezes the protection window at its captured end.
        uint256 openedAt = challengeOpenedAt(subjectId);
        uint256 windowDuration_ = challengeWindowDuration(subjectId);
        protectionEndsAt[subjectId] = openedAt + windowDuration_;

        reversalPending[subjectId] = false;
        abandonmentDeadline[subjectId] = 0;
        sellerPaid[subjectId] = false;
        lastTerminalKind[subjectId] = 0;
    }

    // --- BondedChallenge instance hooks ---

    function isEligibleChallenger(uint256, address challenger) internal view override returns (bool) {
        return challenger == buyer;
    }

    function _requiredBondAmount() internal view override returns (uint256) {
        return _bondAmount;
    }

    function isQualifiedJudge(uint256, address) internal pure override returns (bool) {
        return true;
    }

    function isExcludedJudge(uint256, address challenger, address judge)
        internal
        view
        override
        returns (bool)
    {
        return judge == challenger || judge == seller || judge == agent;
    }

    function _maybeCheckOrdering(
        uint256 subjectId,
        address bondRecipient,
        uint256 bondAmount_
    ) internal view {
        if (!checkOrdering) return;
        if (challenges[subjectId].openedAt != 0) revert OrderingViolation();

        if (pendingClaims(bondRecipient, address(0)) != bondAmount_) revert OrderingViolation();
    }

    function _maybeRevertAfterChecks(TerminalKind kind) internal view {
        if (!revertEnabled) return;
        if (revertTerminal == kind) revert HandlerReverted();
    }

    function _onUpheld(
        uint256 subjectId,
        address /*challenger*/,
        address /*judgeCaller*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Upheld);

        // Settlement instance: upheld means reversal becomes pending.
        reversalPending[subjectId] = true;
        sellerPaid[subjectId] = false;

        // Abandonment deadline is fixed when reversal becomes pending.
        abandonmentDeadline[subjectId] = block.timestamp + abandonmentWindowDuration;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Upheld);

        // Silence unused capture params; tests validate derived end-states.
        openedAt;
        windowDuration_;
    }

    function _onRejected(
        uint256 subjectId,
        address /*challenger*/,
        address /*judgeCaller*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Rejected);

        // Settlement instance: rejected pays seller; challenge terminal.
        sellerPaid[subjectId] = true;
        reversalPending[subjectId] = false;
        abandonmentDeadline[subjectId] = 0;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Rejected);

        openedAt;
        windowDuration_;
    }

    function _onExpired(
        uint256 subjectId,
        address /*challenger*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Expired);

        // Settlement instance: expired pays seller.
        sellerPaid[subjectId] = true;
        reversalPending[subjectId] = false;
        abandonmentDeadline[subjectId] = 0;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Expired);

        openedAt;
        windowDuration_;
    }

    function _onWithdrawn(
        uint256 subjectId,
        address /*challenger*/,
        address bondRecipient,
        uint256 openedAt,
        uint256 windowDuration_,
        uint256 bondAmount_
    ) internal override {
        _maybeCheckOrdering(subjectId, bondRecipient, bondAmount_);
        _maybeRevertAfterChecks(TerminalKind.Withdrawn);

        // Withdrawal restores the protection window from where it stood (captured openedAt + captured window).
        protectionEndsAt[subjectId] = openedAt + windowDuration_;
        sellerPaid[subjectId] = false;
        reversalPending[subjectId] = false;
        abandonmentDeadline[subjectId] = 0;
        lastTerminalKind[subjectId] = uint8(TerminalKind.Withdrawn);
    }

    // ---- Two-phase upheld reversal: abandonment after deadline (CH6) ----

    function abandonReversal(uint256 subjectId) external {
        require(reversalPending[subjectId], "no reversal pending");
        require(block.timestamp >= abandonmentDeadline[subjectId], "abandonment not ready");
        reversalPending[subjectId] = false;
        sellerPaid[subjectId] = true;
    }
}

/// @dev Never configures in the constructor — proves ChallengeNotConfigured / configure errors.
contract BondedChallengeUnconfiguredHarness is BondedChallenge {
    uint256 private immutable _bondAmount;

    constructor(uint256 bondAmount_) {
        require(bondAmount_ != 0, "bondAmount");
        _bondAmount = bondAmount_;
    }

    function configure(address forfeitRecipient_, uint256 windowDuration_) external {
        _configureBondedChallenge(forfeitRecipient_, windowDuration_);
    }

    function _requiredBondAmount() internal view override returns (uint256) {
        return _bondAmount;
    }

    function isEligibleChallenger(uint256, address) internal pure override returns (bool) {
        return true;
    }

    function isQualifiedJudge(uint256, address) internal pure override returns (bool) {
        return true;
    }

    function isExcludedJudge(uint256, address, address) internal pure override returns (bool) {
        return false;
    }

    function _onUpheld(uint256, address, address, address, uint256, uint256, uint256) internal override {}

    function _onRejected(uint256, address, address, address, uint256, uint256, uint256) internal override {}

    function _onExpired(uint256, address, address, uint256, uint256, uint256) internal override {}

    function _onWithdrawn(uint256, address, address, uint256, uint256, uint256) internal override {}
}

