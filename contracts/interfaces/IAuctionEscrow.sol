// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Full external surface for AuctionEscrow (English reserve auction with settlement hold).
interface IAuctionEscrow {
    /// @notice Settlement dispute resolver outcome.
    enum SettlementDisputeOutcome {
        ReleaseToSeller,
        ConfirmFailure
    }

    /// @notice Reason an auction was voided.
    enum VoidReason {
        UnverifiedPassport,
        DisputeGraceExpired
    }

    /// @notice Active or ended auction state for a passport token id.
    struct Auction {
        address seller;
        address agent;
        uint16 agentFeeBps;
        address asset;
        uint128 reserve;
        uint128 ownerMinAsset;
        uint40 duration;
        uint40 startedAt;
        uint40 endsAt;
        address highestBidder;
        uint128 highestBid;
        bool active;
    }

    /// @notice Post-settlement fund hold until buyer confirms or timeout.
    struct SettlementHold {
        address buyer;
        uint128 gross;
        uint40 releaseAt;
        uint40 disputedAt;
        uint128 bond;
        uint40 refundPendingAt;
    }

    /// @notice Owner authorization for an agent to create auctions on their behalf.
    struct AuctionAgentAuth {
        address agent;
        uint64 expiry;
        address asset;
        uint128 ownerMinAsset;
        bool active;
    }

    // ── Events ──────────────────────────────────────────────────────────────

    event AuctionCreated(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed agent,
        address asset,
        uint128 reserve,
        uint40 duration,
        uint16 agentFeeBps
    );
    event AuctionStarted(uint256 indexed tokenId, address indexed firstBidder, uint128 amount, uint40 endsAt);
    event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint128 amount, uint40 endsAt);
    event BidRefunded(uint256 indexed tokenId, address indexed bidder, uint128 amount, bool wrappedFallback);
    event AuctionCancelled(uint256 indexed tokenId, address indexed by);
    event ReturnRequested(uint256 indexed tokenId, address indexed owner);
    event ForceReturn(uint256 indexed tokenId, address indexed owner);
    event AuctionSettled(uint256 indexed tokenId, address indexed buyer, uint128 gross, uint40 releaseAt);
    event AuctionVoided(uint256 indexed tokenId, VoidReason reason);
    event ReceiptConfirmed(uint256 indexed tokenId, address indexed buyer);
    event FundsReleased(
        uint256 indexed tokenId,
        uint128 gross,
        uint128 platformFee,
        uint128 agentFee,
        uint128 net,
        bool autoRelease
    );
    event SettlementDisputeOpened(uint256 indexed tokenId, address indexed buyer, uint128 bond);
    event SettlementDisputeResolved(
        uint256 indexed tokenId, address indexed resolver, SettlementDisputeOutcome outcome
    );
    event PassportReturnedAndRefunded(uint256 indexed tokenId);
    event AbandonedRefundClaimed(uint256 indexed tokenId);
    event AuctionAgentAuthorized(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed agent,
        uint64 expiry,
        address asset,
        uint128 ownerMinAsset
    );
    event AuctionAgentRevoked(uint256 indexed tokenId, address indexed owner);
    event ExtensionWindowSet(uint40 previous, uint40 next);
    event MinIncrementBpsSet(uint16 previous, uint16 next);
    event MinDurationSet(uint40 previous, uint40 next);
    event MaxDurationSet(uint40 previous, uint40 next);
    event SettlementHoldSet(uint40 previous, uint40 next);
    event SettlementDisputeBondSet(uint128 previous, uint128 next);
    event DisputeResolutionTimeoutSet(uint40 previous, uint40 next);
    event DisputeGracePeriodSet(uint40 previous, uint40 next);
    event Paused(bool paused);
    event UpgradeAuthorityTransferred(address indexed previous, address indexed next);

    // ── Errors ──────────────────────────────────────────────────────────────

    error NotSeller();
    error NotAgent();
    error NotOwner();
    error NotActiveVerifier();
    error PassportNotVerified();
    error PassportDisputed();
    error AuctionExists();
    error NoAuction();
    error AuctionAlreadyStarted();
    error AuctionNotStarted();
    error AuctionNotEnded();
    error AuctionEnded();
    error BidTooLow();
    error BidFromSeller();
    error BidFromAgent();
    error WrongAsset();
    error WrongValue();
    error UnsupportedAsset();
    error BadDuration();
    error BadReserve();
    error BelowOwnerMinAsset();
    error AgentNotAuthorized();
    error AgentAuthorizationActive();
    error EscrowNotApproved();
    error ReturnNotRequested();
    error ReturnAlreadyRequested();
    error ReturnCooldownPending();
    error HoldActive();
    error NoHold();
    error HoldReleased();
    error SettlementPending();
    error DisputeActive();
    error NoDispute();
    error BondTooLow();
    error CannotResolveOwnDeal();
    error RefundNotPending();
    error TransferFailed();
    error ContractPaused();
    error NotUpgradeAuthority();
    error FeeTooHigh();
    error AgentFeeTooHigh();
    error ZeroAddress();
    error DirectEthNotAccepted();
    error BadConfig();

    // ── Views ───────────────────────────────────────────────────────────────

    /// @notice Returns whether `tokenId` has an active auction.
    function isAuctionActive(uint256 tokenId) external view returns (bool);

    // ── Auction lifecycle ───────────────────────────────────────────────────

    /// @notice Seller (KarPro-verified) opens a direct auction.
    function createAuction(uint256 tokenId, address asset, uint128 reserve, uint40 duration) external;

    /// @notice Owner authorizes an agent to create auctions in a fixed settlement asset.
    function authorizeAuctionAgent(
        uint256 tokenId,
        address agent,
        uint64 expiry,
        address asset,
        uint128 ownerMinAsset
    ) external;

    /// @notice Owner revokes agent authorization when no auction is active.
    function revokeAuctionAgent(uint256 tokenId) external;

    /// @notice Agent creates an auction on behalf of the owner.
    function createAuctionOnBehalf(
        uint256 tokenId,
        address asset,
        uint128 reserve,
        uint40 duration,
        uint16 agentFeeBps
    ) external;

    /// @notice Place a bid in the auction settlement asset.
    function bid(uint256 tokenId, uint128 amount) external payable;

    /// @notice Seller cancels a direct auction before the first qualifying bid.
    function cancelAuction(uint256 tokenId) external;

    /// @notice Agent cancels an agent auction before the first qualifying bid.
    function agentCancelAuction(uint256 tokenId) external;

    /// @notice Owner requests return of NFT from agent auction (starts 7-day cooldown).
    function requestReturn(uint256 tokenId) external;

    /// @notice Owner force-returns NFT after cooldown on agent auction.
    function forceReturn(uint256 tokenId) external;

    /// @notice Permissionless settle after auction end with VERIFIED passport.
    function settle(uint256 tokenId) external;

    /// @notice Permissionless void for UNVERIFIED passport or dispute grace expiry.
    function voidAuction(uint256 tokenId) external;

    // ── Settlement hold ─────────────────────────────────────────────────────

    /// @notice Buyer confirms receipt before releaseAt for immediate payout.
    function confirmReceipt(uint256 tokenId) external;

    /// @notice Permissionless payout on hold timeout or dispute resolution timeout.
    function releaseFunds(uint256 tokenId) external;

    /// @notice Buyer opens settlement dispute with native bond.
    function openSettlementDispute(uint256 tokenId) external payable;

    /// @notice Active verifier resolves settlement dispute.
    function resolveSettlementDispute(uint256 tokenId, SettlementDisputeOutcome outcome) external;

    /// @notice Buyer returns NFT and receives gross + bond after ConfirmFailure.
    function returnPassportAndRefund(uint256 tokenId) external;

    /// @notice Seller claims payout when buyer abandoned refund after ConfirmFailure.
    function claimAbandonedRefund(uint256 tokenId) external;

    // ── Admin ───────────────────────────────────────────────────────────────

    function setPaused(bool value) external;
    function setExtensionWindow(uint40 value) external;
    function setMinIncrementBps(uint16 value) external;
    function setMinDuration(uint40 value) external;
    function setMaxDuration(uint40 value) external;
    function setSettlementHold(uint40 value) external;
    function setSettlementDisputeBond(uint128 value) external;
    function setDisputeResolutionTimeout(uint40 value) external;
    function setDisputeGracePeriod(uint40 value) external;
    function transferUpgradeAuthority(address newAuthority) external;
}
