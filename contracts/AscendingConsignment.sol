// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

import {IKarPassportEncumbrance} from "./interfaces/IKarPassportEncumbrance.sol";
import {BondedChallenge} from "./lib/BondedChallenge.sol";
import {ConsignmentBase} from "./lib/ConsignmentBase.sol";
import {Erc20Admission} from "./lib/Erc20Admission.sol";

interface IKarProActive {
    function isActiveVerifier(address account) external view returns (bool);
}

/**
 * @title AscendingConsignment
 * @notice Ascending (auction) selling mode: BINDING, HELD, settlement challenge, two-phase reversal.
 *
 * @dev Spec: docs/research/commerce-model-2026.md §4.2–§4.3, §7.3–§7.4, §11 G3/G4, §13a.1.
 *      Settlement challenge is BondedChallenge — this contract supplies eligibility, exclusions,
 *      forfeit recipient, and the four handlers only. No second challenge state machine here.
 *
 *      UUPS; owner = timelock; guardian pauses (G3). Pause gates ascending open + bid only —
 *      never settle, hold exit, challenge terminals, claims, or recall.
 */
contract AscendingConsignment is
    ConsignmentBase,
    BondedChallenge,
    UUPSUpgradeable,
    IERC721Receiver,
    IKarPassportEncumbrance
{
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.1.0-rc.1";

    uint256 internal constant _BPS = 10_000;

    IERC721 public karPassport;
    IKarProActive public karProStaking;
    /// @dev Settlement challenge bond (exact match at open). Captured into Challenge at open (§11).
    uint256 private _challengeBond;

    /// @dev Live auction rules (future opens / bids / settles). Read via `auctionRules()`.
    uint40 internal minDuration;
    uint40 internal maxDuration;
    /// @dev Anti-sniping window. Mutable: applies from the next bid (B3) — never rewrites a captured endsAt alone.
    uint40 internal extensionWindow;
    /// @dev Minimum raise over the standing high bid, in bps. Mutable for subsequent bids (B3).
    uint16 internal minIncrementBps;
    /// @dev Protection length applied at settle (H1). Mutable for future settles only.
    uint40 internal protectionWindow;
    /// @dev Abandonment length applied when reversal becomes pending (CH5). Mutable for future reversals only.
    uint40 internal abandonmentWindow;

    /// @notice Complete live auction-rule set (governance + open floors).
    struct AuctionRules {
        uint40 minDuration;
        uint40 maxDuration;
        uint40 extensionWindow;
        uint16 minIncrementBps;
        uint40 protectionWindow;
        uint40 abandonmentWindow;
        uint256 challengeBond;
    }

    /// @dev Slot 0: five uint40 + uint16 (216 bits). Slot 1: highestBidder. Slot 2: highestBid.
    ///      Terms that govern a live lot are frozen at open (G1); storage setters only affect later opens.
    struct AuctionTerms {
        uint40 duration;
        uint40 endsAt;
        uint40 extensionWindow;
        uint40 protectionWindow;
        uint40 abandonmentWindow;
        uint16 minIncrementBps;
        address highestBidder;
        uint128 highestBid;
    }

    struct Hold {
        address buyer;
        uint128 gross;
        uint64 protectionEndsAt;
        /// @dev Non-zero while a settlement challenge is open: remaining protection seconds frozen at open.
        uint64 frozenRemaining;
        bool reversalPending;
        uint64 abandonmentDeadline;
        /// @dev Copied from AuctionTerms at settle (auction storage is deleted before uphold).
        uint40 abandonmentWindow;
    }

    mapping(uint256 tokenId => AuctionTerms) internal _auction;
    mapping(uint256 tokenId => Hold) internal _holds;
    mapping(address token => bool) public paymentTokenEnabled;

    /// @dev ClaimablePayouts / BondedChallenge / ConsignmentBase own their gaps. Child reserve.
    uint256[48] private __gap;

    error AscendingOpenPath();
    error TermsFixed();
    error NotActiveVerifier();
    error BadDuration();
    error BadConfig();
    error BadReserve();
    error BidFromSeller();
    error BidFromAgent();
    error BidTooLow();
    error NotBinding();
    error AuctionEnded();
    error AuctionNotEnded();
    error NoHold();
    error HoldNotReady();
    error NotHoldBuyer();
    error ReversalPending();
    error NoReversalPending();
    error AbandonmentNotReady();
    error ProtectionElapsed();
    error SettlementPending();
    error PaymentTokenNotSupported();
    error DirectEthNotAccepted();
    error NotPassportHolder();

    event AuctionRulesSet(
        uint40 minDuration,
        uint40 maxDuration,
        uint40 extensionWindow,
        uint16 minIncrementBps,
        uint40 protectionWindow,
        uint40 abandonmentWindow,
        uint256 challengeBond
    );
    event PaymentTokenApproved(address indexed token);
    event PaymentTokenRevoked(address indexed token);
    event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint128 amount, uint40 endsAt);
    event BidRefunded(uint256 indexed tokenId, address indexed bidder, address asset, uint128 amount);
    event Settled(uint256 indexed tokenId, address indexed buyer, uint128 gross, uint64 protectionEndsAt);
    event ReceiptConfirmed(uint256 indexed tokenId, address indexed buyer);
    event FundsReleased(uint256 indexed tokenId, address indexed buyer);
    event ReversalStarted(uint256 indexed tokenId, address indexed buyer, uint64 abandonmentDeadline);
    event ReversalCompleted(uint256 indexed tokenId, address indexed buyer);
    event ReversalAbandoned(uint256 indexed tokenId, address indexed buyer);
    event AscendingTermsSnapshotted(
        uint256 indexed tokenId,
        uint40 duration,
        uint40 extensionWindow,
        uint40 protectionWindow,
        uint40 abandonmentWindow,
        uint16 minIncrementBps,
        uint128 reserve
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address passport_,
        address karProStaking_,
        address platformRecipient_,
        uint256 feeBps_,
        address forfeitRecipient_,
        uint256 challengeBond_,
        uint256 challengeWindow_,
        uint40 minDuration_,
        uint40 maxDuration_,
        uint40 extensionWindow_,
        uint16 minIncrementBps_,
        uint40 protectionWindow_,
        uint40 abandonmentWindow_,
        address initialOwner_,
        address guardian_
    ) external initializer {
        if (passport_ == address(0) || karProStaking_ == address(0) || forfeitRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (challengeBond_ == 0) revert BadConfig();
        if (minDuration_ == 0 || maxDuration_ < minDuration_) revert BadConfig();
        if (extensionWindow_ == 0 || protectionWindow_ == 0 || abandonmentWindow_ == 0) revert BadConfig();
        if (minIncrementBps_ == 0 || minIncrementBps_ > _BPS) revert BadConfig();

        __ConsignmentBase_init(platformRecipient_, feeBps_, initialOwner_, guardian_);
        _configureBondedChallenge(forfeitRecipient_, challengeWindow_);

        karPassport = IERC721(passport_);
        karProStaking = IKarProActive(karProStaking_);
        _challengeBond = challengeBond_;
        minDuration = minDuration_;
        maxDuration = maxDuration_;
        extensionWindow = extensionWindow_;
        minIncrementBps = minIncrementBps_;
        protectionWindow = protectionWindow_;
        abandonmentWindow = abandonmentWindow_;
    }

    // ---- Admin ----

    /// @notice Replace the full live auction-rule set (future opens / bids / settles / challenges).
    /// @dev Timelock queue is serialized: a later scheduled full-set execute wins over an earlier one.
    function setAuctionRules(
        uint40 minDuration_,
        uint40 maxDuration_,
        uint40 extensionWindow_,
        uint16 minIncrementBps_,
        uint40 protectionWindow_,
        uint40 abandonmentWindow_,
        uint256 challengeBond_
    ) external onlyOwner {
        if (minDuration_ == 0 || maxDuration_ < minDuration_) revert BadConfig();
        if (extensionWindow_ == 0 || protectionWindow_ == 0 || abandonmentWindow_ == 0) revert BadConfig();
        if (minIncrementBps_ == 0 || minIncrementBps_ > _BPS) revert BadConfig();
        if (challengeBond_ == 0) revert BadConfig();

        minDuration = minDuration_;
        maxDuration = maxDuration_;
        extensionWindow = extensionWindow_;
        minIncrementBps = minIncrementBps_;
        protectionWindow = protectionWindow_;
        abandonmentWindow = abandonmentWindow_;
        _challengeBond = challengeBond_;

        emit AuctionRulesSet(
            minDuration_,
            maxDuration_,
            extensionWindow_,
            minIncrementBps_,
            protectionWindow_,
            abandonmentWindow_,
            challengeBond_
        );
    }

    function approvePaymentToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        Erc20Admission.requireConforming(token);
        Erc20Admission.requireDecimals(token);
        paymentTokenEnabled[token] = true;
        emit PaymentTokenApproved(token);
    }

    function revokePaymentToken(address token) external onlyOwner {
        delete paymentTokenEnabled[token];
        emit PaymentTokenRevoked(token);
    }

    // ---- Obligation answers (passport registry will consult this shape next) ----

    /// @inheritdoc IKarPassportEncumbrance
    /// @dev This source alone: unresolved settlement forbids both intents; otherwise allows.
    function may(uint256 tokenId, Intent intent) external view override returns (bool) {
        intent; // both intents share the same forbidding obligation
        return !_hasUnresolvedSettlement(tokenId);
    }

    // ---- Opening (duration term — base signature cannot carry it) ----

    /// @dev Base open without duration is refused; use `openAscendingDirect` / `openAscendingFromMandate`.
    function openDirect(uint256, Denomination calldata, address, uint128) external pure override {
        revert AscendingOpenPath();
    }

    function openFromMandate(uint256, Denomination calldata, uint128) external pure override {
        revert AscendingOpenPath();
    }

    function openAscendingDirect(
        uint256 tokenId,
        address asset,
        uint128 reserve,
        uint40 duration
    ) external nonReentrant {
        _requireNotPaused();
        address owner_ = passportOwner(tokenId);
        if (owner_ != msg.sender) revert NotPassportOwner();
        Denomination memory denom = Denomination(DenominationKind.Asset, bytes32(0));
        _requireModeOpen(tokenId, owner_, denom, asset);
        _requireCanOpen(tokenId, owner_);
        _requireAuctionOpenParams(reserve, duration, asset);

        _takeCustody(tokenId, owner_);
        _writeOpen({
            tokenId: tokenId,
            seller: owner_,
            agent: address(0),
            asset: asset,
            denomination: denom,
            floor: 0,
            compensation: Compensation(CompensationForm.Margin, 0),
            price: reserve
        });
        _writeAuctionTerms(tokenId, duration);
    }

    function openAscendingFromMandate(uint256 tokenId, uint128 reserve, uint40 duration) external nonReentrant {
        _requireNotPaused();
        Denomination memory denom = Denomination(DenominationKind.Asset, bytes32(0));
        MandateRecord memory m = _requireMandateAllowsOpen(tokenId, denom);
        _requireAgentCaller(m.agent);
        address owner_ = passportOwner(tokenId);
        _requireModeOpen(tokenId, m.agent, m.denomination, m.asset);
        _requireCanOpen(tokenId, owner_);
        _requireAuctionOpenParams(reserve, duration, m.asset);
        _requireAgentedPriceMeetsFloor(reserve, m.floor, m.compensation, platformFeeBps);

        _takeCustody(tokenId, owner_);
        _writeOpen({
            tokenId: tokenId,
            seller: owner_,
            agent: m.agent,
            asset: m.asset,
            denomination: m.denomination,
            floor: m.floor,
            compensation: m.compensation,
            price: reserve
        });
        _writeAuctionTerms(tokenId, duration);
    }

    // ---- Bidding ----

    function bid(uint256 tokenId, uint128 amount) external payable nonReentrant {
        _requireNotPaused();
        if (_holds[tokenId].buyer != address(0)) revert SettlementPending();
        if (!_isOfferedActionable(tokenId) && !_isBinding(tokenId)) revert NotOffered();

        Consignment storage c = _consignments[tokenId];
        if (msg.sender == c.seller) revert BidFromSeller();
        if (msg.sender == c.agent) revert BidFromAgent();

        AuctionTerms storage a = _auction[tokenId];
        if (a.endsAt != 0 && block.timestamp >= a.endsAt) revert AuctionEnded();

        if (a.highestBidder == address(0)) {
            if (amount < c.price) revert BidTooLow();
        } else {
            uint256 minNext = uint256(a.highestBid) + (uint256(a.highestBid) * a.minIncrementBps) / _BPS;
            if (uint256(amount) < minNext || amount <= a.highestBid) revert BidTooLow();
        }

        address prevBidder = a.highestBidder;
        uint128 prevAmount = a.highestBid;

        _pullBid(c.asset, amount);

        if (a.highestBidder == address(0)) {
            _enterCommittedNotOffered(tokenId);
            a.endsAt = uint40(block.timestamp + a.duration);
        }

        a.highestBidder = msg.sender;
        a.highestBid = amount;
        _applyExtension(a);
        emit BidPlaced(tokenId, msg.sender, amount, a.endsAt);

        if (prevBidder != address(0)) {
            _refundBid(tokenId, prevBidder, c.asset, prevAmount);
        }
    }

    // ---- Settlement (B1 single exit / B2 non-callback delivery) ----

    /// @dev `transferFrom` (not safe): buyer self-selected by a fully escrowed bid (B2).
    function settle(uint256 tokenId) external nonReentrant {
        if (!_isBinding(tokenId)) revert NotBinding();
        AuctionTerms storage a = _auction[tokenId];
        if (a.endsAt == 0) revert NotBinding();
        if (block.timestamp < a.endsAt) revert AuctionNotEnded();
        if (_holds[tokenId].buyer != address(0)) revert SettlementPending();

        address buyer = a.highestBidder;
        uint128 gross = a.highestBid;
        uint64 ends = uint64(block.timestamp + a.protectionWindow);
        uint40 abandonWin = a.abandonmentWindow;

        // Clear auction terms; consignment snapshot retained for split until hold closes.
        delete _auction[tokenId];

        karPassport.transferFrom(address(this), buyer, tokenId);

        _holds[tokenId] = Hold({
            buyer: buyer,
            gross: gross,
            protectionEndsAt: ends,
            frozenRemaining: 0,
            reversalPending: false,
            abandonmentDeadline: 0,
            abandonmentWindow: abandonWin
        });

        emit Settled(tokenId, buyer, gross, ends);
    }

    function confirmReceipt(uint256 tokenId) external nonReentrant {
        Hold storage h = _requireActiveHold(tokenId);
        if (msg.sender != h.buyer) revert NotHoldBuyer();
        _requireNoChallenge(tokenId);
        if (h.reversalPending) revert ReversalPending();
        address buyer = h.buyer;
        _payoutHoldAndClose(tokenId, CloseReason.HoldReleased);
        emit ReceiptConfirmed(tokenId, buyer);
    }

    function releaseFunds(uint256 tokenId) external nonReentrant {
        Hold storage h = _requireActiveHold(tokenId);
        _requireNoChallenge(tokenId);
        if (h.reversalPending) revert ReversalPending();
        if (block.timestamp < h.protectionEndsAt) revert HoldNotReady();
        address buyer = h.buyer;
        _payoutHoldAndClose(tokenId, CloseReason.HoldReleased);
        emit FundsReleased(tokenId, buyer);
    }

    /// @notice Buyer returns the passport after an upheld challenge and is paid the settled amount.
    /// @dev Bond already routed to the buyer by BondedChallenge on uphold (library sequencing).
    function completeReversal(uint256 tokenId) external nonReentrant {
        Hold storage h = _requireActiveHold(tokenId);
        if (!h.reversalPending) revert NoReversalPending();
        if (msg.sender != h.buyer) revert NotHoldBuyer();
        if (karPassport.ownerOf(tokenId) != h.buyer) revert NotPassportHolder();

        address buyer = h.buyer;
        uint128 gross = h.gross;
        address asset = _consignments[tokenId].asset;

        delete _holds[tokenId];
        karPassport.transferFrom(buyer, address(this), tokenId);

        // Pay buyer the escrowed sale amount; passport returns to seller via terminate.
        if (asset == address(0)) {
            _payNative(buyer, gross);
        } else {
            _payErc20(asset, buyer, gross);
        }

        _terminateToOwner(tokenId, CloseReason.ReversalCompleted);
        emit ReversalCompleted(tokenId, buyer);
    }

    /// @notice After the abandonment deadline, pay the seller as though the challenge had failed (CH5).
    function abandonReversal(uint256 tokenId) external nonReentrant {
        Hold storage h = _requireActiveHold(tokenId);
        if (!h.reversalPending) revert NoReversalPending();
        if (block.timestamp < h.abandonmentDeadline) revert AbandonmentNotReady();
        address buyer = h.buyer;
        _payoutHoldAndClose(tokenId, CloseReason.ReversalAbandoned);
        emit ReversalAbandoned(tokenId, buyer);
    }

    // ---- Settlement challenge (BondedChallenge instance) ----

    function open(uint256 subjectId) public payable override nonReentrant {
        Hold storage h = _requireActiveHold(subjectId);
        if (h.reversalPending) revert ReversalPending();
        if (h.frozenRemaining != 0) revert DisputeActive();
        if (block.timestamp >= h.protectionEndsAt) revert ProtectionElapsed();

        h.frozenRemaining = uint64(h.protectionEndsAt - block.timestamp);
        _openChallenge(subjectId, msg.sender, msg.value);
    }

    function isEligibleChallenger(uint256 subjectId, address challenger) internal view override returns (bool) {
        Hold storage h = _holds[subjectId];
        return h.buyer != address(0) && challenger == h.buyer && !h.reversalPending;
    }

    function isQualifiedJudge(uint256, address judge_) internal view override returns (bool) {
        return karProStaking.isActiveVerifier(judge_);
    }

    function _requiredBondAmount() internal view override returns (uint256) {
        return _challengeBond;
    }

    function isExcludedJudge(uint256 subjectId, address /*challenger*/, address judge_)
        internal
        view
        override
        returns (bool)
    {
        Consignment storage c = _consignments[subjectId];
        Hold storage h = _holds[subjectId];
        return judge_ == h.buyer || judge_ == c.seller || (c.agent != address(0) && judge_ == c.agent);
    }

    function _onUpheld(
        uint256 subjectId,
        address, /*challenger*/
        address, /*judgeCaller*/
        address, /*bondRecipient*/
        uint256, /*openedAt*/
        uint256, /*windowDuration_*/
        uint256 /*bondAmount_*/
    ) internal override {
        Hold storage h = _holds[subjectId];
        h.reversalPending = true;
        h.frozenRemaining = 0;
        h.protectionEndsAt = 0;
        h.abandonmentDeadline = uint64(block.timestamp + h.abandonmentWindow);
        emit ReversalStarted(subjectId, h.buyer, h.abandonmentDeadline);
    }

    function _onRejected(
        uint256 subjectId,
        address, /*challenger*/
        address, /*judgeCaller*/
        address, /*bondRecipient*/
        uint256, /*openedAt*/
        uint256, /*windowDuration_*/
        uint256 /*bondAmount_*/
    ) internal override {
        _payoutHoldAndClose(subjectId, CloseReason.HoldReleased);
    }

    function _onExpired(
        uint256 subjectId,
        address, /*challenger*/
        address, /*bondRecipient*/
        uint256, /*openedAt*/
        uint256, /*windowDuration_*/
        uint256 /*bondAmount_*/
    ) internal override {
        _payoutHoldAndClose(subjectId, CloseReason.HoldReleased);
    }

    function _onWithdrawn(
        uint256 subjectId,
        address, /*challenger*/
        address, /*bondRecipient*/
        uint256, /*openedAt*/
        uint256, /*windowDuration_*/
        uint256 /*bondAmount_*/
    ) internal override {
        Hold storage h = _holds[subjectId];
        uint64 remaining = h.frozenRemaining;
        h.frozenRemaining = 0;
        h.protectionEndsAt = uint64(block.timestamp + remaining);
    }

    // ---- Views ----

    function auctionEndsAt(uint256 tokenId) external view returns (uint40) {
        return _auction[tokenId].endsAt;
    }

    function auctionHighestBid(uint256 tokenId) external view returns (uint128) {
        return _auction[tokenId].highestBid;
    }

    function auctionHighestBidder(uint256 tokenId) external view returns (address) {
        return _auction[tokenId].highestBidder;
    }

    function auctionDuration(uint256 tokenId) external view returns (uint40) {
        return _auction[tokenId].duration;
    }

    function auctionExtensionWindow(uint256 tokenId) external view returns (uint40) {
        return _auction[tokenId].extensionWindow;
    }

    function auctionProtectionWindow(uint256 tokenId) external view returns (uint40) {
        return _auction[tokenId].protectionWindow;
    }

    function auctionAbandonmentWindow(uint256 tokenId) external view returns (uint40) {
        return _auction[tokenId].abandonmentWindow;
    }

    function auctionMinIncrementBps(uint256 tokenId) external view returns (uint16) {
        return _auction[tokenId].minIncrementBps;
    }

    /// @notice Live auction-rule set (governance storage; lot snapshots are separate views).
    function auctionRules() external view returns (AuctionRules memory) {
        return AuctionRules({
            minDuration: minDuration,
            maxDuration: maxDuration,
            extensionWindow: extensionWindow,
            minIncrementBps: minIncrementBps,
            protectionWindow: protectionWindow,
            abandonmentWindow: abandonmentWindow,
            challengeBond: _challengeBond
        });
    }

    function holdBuyer(uint256 tokenId) external view returns (address) {
        return _holds[tokenId].buyer;
    }

    function holdGross(uint256 tokenId) external view returns (uint128) {
        return _holds[tokenId].gross;
    }

    function holdProtectionEndsAt(uint256 tokenId) external view returns (uint64) {
        return _holds[tokenId].protectionEndsAt;
    }

    function holdFrozenRemaining(uint256 tokenId) external view returns (uint64) {
        return _holds[tokenId].frozenRemaining;
    }

    function holdReversalPending(uint256 tokenId) external view returns (bool) {
        return _holds[tokenId].reversalPending;
    }

    function holdAbandonmentDeadline(uint256 tokenId) external view returns (uint64) {
        return _holds[tokenId].abandonmentDeadline;
    }

    function holdAbandonmentWindow(uint256 tokenId) external view returns (uint40) {
        return _holds[tokenId].abandonmentWindow;
    }

    function isBinding(uint256 tokenId) external view returns (bool) {
        return _isBinding(tokenId);
    }

    function hasUnresolvedSettlement(uint256 tokenId) external view returns (bool) {
        return _hasUnresolvedSettlement(tokenId);
    }

    // ---- Instance hooks ----

    function _requireModeOpen(
        uint256, /*tokenId*/
        address runner,
        Denomination memory denomination,
        address asset
    ) internal view override {
        // P1/N4: callers construct Asset denom; fiat mandates fail DenominationMismatch at mandate gate.
        denomination;
        if (!karProStaking.isActiveVerifier(runner)) revert NotActiveVerifier();
        if (asset != address(0) && !paymentTokenEnabled[asset]) revert PaymentTokenNotSupported();
    }

    /// @dev C4: terms including reserve are fixed at creation.
    function setPrice(uint256, uint128) external pure override {
        revert TermsFixed();
    }

    function isEscrowApproved(uint256 tokenId, address owner_) internal view override returns (bool) {
        return karPassport.getApproved(tokenId) == address(this) || karPassport.isApprovedForAll(owner_, address(this));
    }

    function passportOwner(uint256 tokenId) internal view override returns (address) {
        return karPassport.ownerOf(tokenId);
    }

    function _may(uint256 tokenId, IKarPassportEncumbrance.Intent intent) internal view override returns (bool) {
        return IKarPassportEncumbrance(address(karPassport)).may(tokenId, intent);
    }

    function _takeCustody(uint256 tokenId, address from) internal override {
        karPassport.transferFrom(from, address(this), tokenId);
    }

    function _releaseCustody(uint256 tokenId, address to) internal override {
        // Ascending settle uses non-safe transfer; withdraw/recall still release to seller.
        karPassport.transferFrom(address(this), to, tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        revert DirectEthNotAccepted();
    }

    // ---- UUPS ----

    function _authorizeUpgrade(address) internal view override onlyOwner {}

    // ---- Internals ----

    function _requireAuctionOpenParams(uint128 reserve, uint40 duration, address asset) private view {
        if (reserve == 0) revert BadReserve();
        if (duration < minDuration || duration > maxDuration) revert BadDuration();
        if (asset != address(0) && !paymentTokenEnabled[asset]) revert PaymentTokenNotSupported();
    }

    function _isBinding(uint256 tokenId) private view returns (bool) {
        return _phase[tokenId] == Phase.Offered && _committedNotOffered[tokenId] && _holds[tokenId].buyer == address(0);
    }

    function _hasUnresolvedSettlement(uint256 tokenId) private view returns (bool) {
        Hold storage h = _holds[tokenId];
        if (h.buyer == address(0)) return false;
        return true; // any live hold (window, challenge, or reversal) is an unresolved settlement
    }

    function _requireActiveHold(uint256 tokenId) private view returns (Hold storage h) {
        h = _holds[tokenId];
        if (h.buyer == address(0)) revert NoHold();
    }

    function _writeAuctionTerms(uint256 tokenId, uint40 duration) private {
        uint128 reserve = _consignments[tokenId].price;
        _auction[tokenId] = AuctionTerms({
            duration: duration,
            endsAt: 0,
            extensionWindow: extensionWindow,
            protectionWindow: protectionWindow,
            abandonmentWindow: abandonmentWindow,
            minIncrementBps: minIncrementBps,
            highestBidder: address(0),
            highestBid: 0
        });
        emit AscendingTermsSnapshotted(
            tokenId,
            duration,
            extensionWindow,
            protectionWindow,
            abandonmentWindow,
            minIncrementBps,
            reserve
        );
    }

    function _applyExtension(AuctionTerms storage a) private {
        if (a.endsAt == 0) return;
        if (block.timestamp + a.extensionWindow >= a.endsAt) {
            uint40 extended = uint40(block.timestamp + a.extensionWindow);
            if (extended > a.endsAt) a.endsAt = extended;
        }
    }

    function _pullBid(address asset, uint128 amount) private {
        if (asset == address(0)) {
            if (msg.value != amount) revert WrongValue();
        } else {
            if (msg.value != 0) revert DirectEthNotAccepted();
            if (!paymentTokenEnabled[asset]) revert PaymentTokenNotSupported();
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _refundBid(uint256 tokenId, address to, address asset, uint128 amount) private {
        if (asset == address(0)) {
            _payNative(to, amount);
        } else {
            _payErc20(asset, to, amount);
        }
        emit BidRefunded(tokenId, to, asset, amount);
    }

    function _payoutHoldAndClose(uint256 tokenId, CloseReason reason) private {
        Hold memory h = _holds[tokenId];
        delete _holds[tokenId];
        // Passport already with buyer (or abandoned with buyer). Pay sellers from escrowed gross.
        _paySplit(tokenId, h.gross, reason);
    }
}
