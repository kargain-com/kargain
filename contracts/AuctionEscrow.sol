// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Version policy:
//   PATCH (Z): bug fixes that do not change ABI or storage layout
//   MINOR (Y): new functions added, backward compatible
//   MAJOR (X): breaking ABI changes, storage layout changes,
//               or fundamental behavior change
//   Pre-release: -draft for design-phase deployments, bump on mainnet cutover
//   Upgradeable contracts (AuctionEscrow):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAuctionEscrow} from "./interfaces/IAuctionEscrow.sol";

interface IKarPassportAuction {
    function passportStatus(uint256 tokenId) external view returns (uint8);
}

interface IKarProStakingAuction {
    function isActiveVerifier(address account) external view returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title AuctionEscrow
/// @notice English reserve auction escrow with settlement hold and dispute resolution.
/// @dev UUPS upgradeable; timelock is upgrade authority. Separate from MarketplaceEscrow.
/// @custom:version 2.0.0-draft
contract AuctionEscrow is IAuctionEscrow, IERC721Receiver, ReentrancyGuard, Initializable, UUPSUpgradeable {
    string public constant VERSION = "2.0.0-draft";

    using SafeERC20 for IERC20;

    uint256 internal constant _MAX_FEE_BPS = 1000;
    uint256 internal constant _MAX_AGENT_FEE_BPS = 3000;
    uint256 internal constant _RETURN_COOLDOWN = 7 days;
    uint256 internal constant _ETH_TRANSFER_GAS = 30_000;

    uint40 internal constant _MIN_EXTENSION_WINDOW = 60;
    uint40 internal constant _MAX_EXTENSION_WINDOW = 3600;
    uint16 internal constant _MIN_INCREMENT_BPS = 100;
    uint16 internal constant _MAX_INCREMENT_BPS = 1000;

    uint8 internal constant _STATUS_VERIFIED = 1;
    uint8 internal constant _STATUS_DISPUTED = 2;

    IERC721 public immutable karPassport;
    IERC20 public immutable usdc;
    IWETH public immutable wrappedNative;
    address public immutable karProStaking;
    address public immutable platformRecipient;
    uint16 public immutable platformFeeBps;

    address public upgradeAuthority;
    bool public paused;

    uint40 public extensionWindow;
    uint16 public minIncrementBps;
    uint40 public minDuration;
    uint40 public maxDuration;
    uint40 public settlementHold;
    uint128 public settlementDisputeBond;
    uint40 public disputeResolutionTimeout;

    mapping(uint256 tokenId => Auction) public auctions;
    mapping(uint256 tokenId => SettlementHold) public holds;
    mapping(uint256 tokenId => AuctionAgentAuth) public auctionAgentAuthorizations;
    mapping(uint256 tokenId => uint256) public returnRequestedAt;

    uint256[48] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address karPassport_,
        address usdc_,
        address wrappedNative_,
        address karProStaking_,
        address platformRecipient_,
        uint256 feeBps_
    ) {
        _disableInitializers();
        if (karPassport_ == address(0)) revert ZeroAddress();
        if (usdc_ == address(0)) revert ZeroAddress();
        if (wrappedNative_ == address(0)) revert ZeroAddress();
        if (karProStaking_ == address(0)) revert ZeroAddress();
        if (platformRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > _MAX_FEE_BPS) revert FeeTooHigh();

        karPassport = IERC721(karPassport_);
        usdc = IERC20(usdc_);
        wrappedNative = IWETH(wrappedNative_);
        karProStaking = karProStaking_;
        platformRecipient = platformRecipient_;
        platformFeeBps = uint16(feeBps_);
    }

    /// @notice Proxy initializer; sets upgrade authority and default config (§11.2).
    /// @param timelockAddress_ Timelock or deployer EOA for genesis configuration.
    function initialize(address timelockAddress_) external initializer {
        if (timelockAddress_ == address(0)) revert ZeroAddress();
        upgradeAuthority = timelockAddress_;

        extensionWindow = 300;
        minIncrementBps = 300;
        minDuration = 3 days;
        maxDuration = 7 days;
        settlementHold = 7 days;
        settlementDisputeBond = 0.01 ether;
        disputeResolutionTimeout = 30 days;
    }

    /// @inheritdoc IAuctionEscrow
    function isAuctionActive(uint256 tokenId) external view returns (bool) {
        return auctions[tokenId].active;
    }

    /// @inheritdoc IAuctionEscrow
    function createAuction(uint256 tokenId, address asset, uint128 reserve, uint40 duration)
        external
        nonReentrant
    {
        if (paused) revert ContractPaused();
        if (holds[tokenId].releaseAt != 0) revert SettlementPending();
        if (karPassport.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (!IKarProStakingAuction(karProStaking).isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        _requirePassportVerified(tokenId);
        _validateAsset(asset);
        if (reserve == 0) revert BadReserve();
        if (duration < minDuration || duration > maxDuration) revert BadDuration();
        if (auctions[tokenId].active) revert AuctionExists();

        karPassport.safeTransferFrom(msg.sender, address(this), tokenId);
        _writeAuction(tokenId, msg.sender, address(0), 0, asset, reserve, 0, duration);
    }

    /// @inheritdoc IAuctionEscrow
    function authorizeAuctionAgent(
        uint256 tokenId,
        address agent,
        uint64 expiry,
        address asset,
        uint128 ownerMinAsset
    ) external nonReentrant {
        if (paused) revert ContractPaused();
        if (holds[tokenId].releaseAt != 0) revert SettlementPending();
        if (karPassport.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (agent == address(0)) revert AgentNotAuthorized();
        if (auctions[tokenId].active) revert AuctionExists();
        _validateAsset(asset);

        if (
            karPassport.getApproved(tokenId) != address(this)
                && !karPassport.isApprovedForAll(msg.sender, address(this))
        ) {
            revert EscrowNotApproved();
        }

        auctionAgentAuthorizations[tokenId] = AuctionAgentAuth({
            agent: agent,
            expiry: expiry,
            asset: asset,
            ownerMinAsset: ownerMinAsset,
            active: true
        });
        emit AuctionAgentAuthorized(tokenId, msg.sender, agent, expiry, asset, ownerMinAsset);
    }

    /// @inheritdoc IAuctionEscrow
    function revokeAuctionAgent(uint256 tokenId) external nonReentrant {
        if (karPassport.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (auctions[tokenId].active) revert AgentAuthorizationActive();
        delete auctionAgentAuthorizations[tokenId];
        emit AuctionAgentRevoked(tokenId, msg.sender);
    }

    /// @inheritdoc IAuctionEscrow
    function createAuctionOnBehalf(
        uint256 tokenId,
        address asset,
        uint128 reserve,
        uint40 duration,
        uint16 agentFeeBps
    ) external nonReentrant {
        if (paused) revert ContractPaused();
        if (holds[tokenId].releaseAt != 0) revert SettlementPending();
        if (agentFeeBps > _MAX_AGENT_FEE_BPS) revert AgentFeeTooHigh();
        _validateAsset(asset);
        if (reserve == 0) revert BadReserve();
        if (duration < minDuration || duration > maxDuration) revert BadDuration();

        AuctionAgentAuth memory auth = auctionAgentAuthorizations[tokenId];
        if (!auth.active || auth.agent != msg.sender) revert AgentNotAuthorized();
        if (auth.expiry != 0 && block.timestamp > auth.expiry) revert AgentNotAuthorized();
        if (asset != auth.asset) revert WrongAsset();
        if (auctions[tokenId].active) revert AuctionExists();
        if (!IKarProStakingAuction(karProStaking).isActiveVerifier(msg.sender)) revert NotActiveVerifier();

        _checkOwnerMinAtReserve(reserve, agentFeeBps, auth.ownerMinAsset);

        address owner = karPassport.ownerOf(tokenId);
        karPassport.safeTransferFrom(owner, address(this), tokenId);
        _writeAuction(tokenId, owner, msg.sender, agentFeeBps, asset, reserve, auth.ownerMinAsset, duration);
    }

    /// @inheritdoc IAuctionEscrow
    function bid(uint256 tokenId, uint128 amount) external payable nonReentrant {
        if (paused) revert ContractPaused();

        Auction storage a = auctions[tokenId];
        if (!a.active) revert NoAuction();
        if (a.startedAt > 0 && block.timestamp >= a.endsAt) revert AuctionEnded();
        if (msg.sender == a.seller) revert BidFromSeller();
        if (msg.sender == a.agent) revert BidFromAgent();

        if (a.startedAt == 0) {
            if (amount < a.reserve) revert BidTooLow();
        } else {
            uint256 minNext = uint256(a.highestBid) + (uint256(a.highestBid) * minIncrementBps) / 10_000;
            if (uint256(amount) < minNext || amount <= a.highestBid) revert BidTooLow();
        }

        address prevBidder = a.highestBidder;
        uint128 prevAmount = a.highestBid;

        _pullBidFunds(a.asset, amount);

        if (a.startedAt == 0) {
            a.startedAt = uint40(block.timestamp);
            a.endsAt = uint40(block.timestamp + a.duration);
            emit AuctionStarted(tokenId, msg.sender, amount, a.endsAt);
        }

        a.highestBidder = msg.sender;
        a.highestBid = amount;
        _applyExtension(a);
        emit BidPlaced(tokenId, msg.sender, amount, a.endsAt);

        if (prevBidder != address(0)) {
            _refundBidder(tokenId, prevBidder, prevAmount, a.asset);
        }
    }

    /// @inheritdoc IAuctionEscrow
    function cancelAuction(uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[tokenId];
        if (!a.active) revert NoAuction();
        if (a.seller != msg.sender) revert NotSeller();
        if (a.agent != address(0)) revert NotAgent();
        if (a.startedAt > 0) revert AuctionAlreadyStarted();
        _cancelAuction(tokenId, msg.sender);
    }

    /// @inheritdoc IAuctionEscrow
    function agentCancelAuction(uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[tokenId];
        if (!a.active) revert NoAuction();
        if (a.agent != msg.sender) revert NotAgent();
        if (a.startedAt > 0) revert AuctionAlreadyStarted();
        _cancelAuction(tokenId, msg.sender);
    }

    /// @inheritdoc IAuctionEscrow
    function requestReturn(uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[tokenId];
        if (!a.active) revert NoAuction();
        if (a.seller != msg.sender) revert NotOwner();
        if (a.agent == address(0)) revert NotAgent();
        if (a.startedAt > 0) revert AuctionAlreadyStarted();
        if (returnRequestedAt[tokenId] != 0) revert ReturnAlreadyRequested();
        returnRequestedAt[tokenId] = block.timestamp;
        emit ReturnRequested(tokenId, msg.sender);
    }

    /// @inheritdoc IAuctionEscrow
    function forceReturn(uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[tokenId];
        if (!a.active) revert NoAuction();
        if (a.seller != msg.sender) revert NotOwner();
        if (a.startedAt > 0) revert AuctionAlreadyStarted();
        uint256 requestedAt = returnRequestedAt[tokenId];
        if (requestedAt == 0) revert ReturnNotRequested();
        if (block.timestamp < requestedAt + _RETURN_COOLDOWN) revert ReturnCooldownPending();
        _cancelAuction(tokenId, msg.sender);
        emit ForceReturn(tokenId, msg.sender);
    }

    /// @inheritdoc IAuctionEscrow
    /// @dev NFT transfer uses `transferFrom` (not `safeTransferFrom`): the buyer self-selected
    ///      by placing a fully escrowed bid, so the ERC-721 receiver hook protects nobody here
    ///      while enabling a hostage window against the seller if settle could revert.
    function settle(uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[tokenId];
        if (!a.active) revert NoAuction();
        if (a.startedAt == 0) revert AuctionNotStarted();
        if (block.timestamp < a.endsAt) revert AuctionNotEnded();

        address buyer = a.highestBidder;
        uint128 gross = a.highestBid;

        a.active = false;

        karPassport.transferFrom(address(this), buyer, tokenId);

        holds[tokenId] = SettlementHold({
            buyer: buyer,
            gross: gross,
            releaseAt: uint40(block.timestamp + settlementHold),
            disputedAt: 0,
            bond: 0,
            refundPendingAt: 0
        });

        emit AuctionSettled(tokenId, buyer, gross, holds[tokenId].releaseAt);
    }

    /// @inheritdoc IAuctionEscrow
    function confirmReceipt(uint256 tokenId) external nonReentrant {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();
        if (h.refundPendingAt > 0) revert RefundNotPending();
        if (msg.sender != h.buyer) revert NotBuyer();
        if (h.disputedAt > 0) revert DisputeActive();
        if (block.timestamp >= h.releaseAt) revert HoldActive();

        _payout(tokenId, false, msg.sender, 0);
        emit ReceiptConfirmed(tokenId, msg.sender);
    }

    /// @inheritdoc IAuctionEscrow
    function releaseFunds(uint256 tokenId) external nonReentrant {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();
        if (h.refundPendingAt > 0) revert RefundNotPending();

        address bondRecipient = address(0);
        bool autoRelease = true;

        if (h.disputedAt == 0) {
            if (block.timestamp < h.releaseAt) revert HoldActive();
        } else {
            if (block.timestamp < h.disputedAt + disputeResolutionTimeout) revert DisputeActive();
            bondRecipient = platformRecipient;
        }

        _payout(tokenId, autoRelease, bondRecipient, h.bond);
    }

    /// @inheritdoc IAuctionEscrow
    function openSettlementDispute(uint256 tokenId) external payable nonReentrant {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();
        if (msg.sender != h.buyer) revert NotBuyer();
        if (h.disputedAt > 0) revert DisputeActive();
        if (h.refundPendingAt > 0) revert RefundNotPending();
        if (block.timestamp >= h.releaseAt) revert HoldActive();
        if (msg.value < settlementDisputeBond) revert BondTooLow();

        h.disputedAt = uint40(block.timestamp);
        h.bond = uint128(msg.value);
        emit SettlementDisputeOpened(tokenId, msg.sender, h.bond);
    }

    /// @inheritdoc IAuctionEscrow
    function resolveSettlementDispute(uint256 tokenId, SettlementDisputeOutcome outcome)
        external
        nonReentrant
    {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();
        if (h.disputedAt == 0) revert NoDispute();
        if (h.refundPendingAt > 0) revert RefundNotPending();
        if (!IKarProStakingAuction(karProStaking).isActiveVerifier(msg.sender)) revert NotActiveVerifier();

        Auction storage a = auctions[tokenId];
        if (msg.sender == h.buyer || msg.sender == a.seller || msg.sender == a.agent) {
            revert CannotResolveOwnDeal();
        }

        if (outcome == SettlementDisputeOutcome.ReleaseToSeller) {
            _payout(tokenId, false, msg.sender, h.bond);
        } else {
            h.refundPendingAt = uint40(block.timestamp);
        }

        emit SettlementDisputeResolved(tokenId, msg.sender, outcome);
    }

    /// @inheritdoc IAuctionEscrow
    function returnPassportAndRefund(uint256 tokenId) external nonReentrant {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();
        if (h.refundPendingAt == 0) revert RefundNotPending();
        if (msg.sender != h.buyer) revert NotBuyer();

        Auction storage a = auctions[tokenId];
        address seller = a.seller;
        address asset = a.asset;
        uint128 gross = h.gross;
        uint128 bond = h.bond;
        address buyer = h.buyer;

        delete holds[tokenId];
        _clearAuctionStorage(tokenId);

        karPassport.safeTransferFrom(buyer, seller, tokenId);

        if (asset == address(0)) {
            _safeTransferETHWithFallback(buyer, uint256(gross) + uint256(bond));
        } else {
            usdc.safeTransfer(buyer, gross);
            if (bond > 0) _safeTransferETHWithFallback(buyer, bond);
        }

        emit PassportReturnedAndRefunded(tokenId);
    }

    /// @inheritdoc IAuctionEscrow
    function claimAbandonedRefund(uint256 tokenId) external nonReentrant {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();
        if (h.refundPendingAt == 0) revert RefundNotPending();
        if (block.timestamp < h.refundPendingAt + settlementHold) revert HoldActive();

        Auction storage a = auctions[tokenId];
        if (msg.sender != a.seller) revert NotSeller();

        uint128 bond = h.bond;
        _payout(tokenId, false, platformRecipient, bond);
        emit AbandonedRefundClaimed(tokenId);
    }

    /// @inheritdoc IAuctionEscrow
    function setPaused(bool value) external {
        _onlyUpgradeAuthority();
        paused = value;
        emit Paused(value);
    }

    /// @inheritdoc IAuctionEscrow
    function setExtensionWindow(uint40 value) external {
        _onlyUpgradeAuthority();
        if (value < _MIN_EXTENSION_WINDOW || value > _MAX_EXTENSION_WINDOW) revert BadConfig();
        uint40 previous = extensionWindow;
        extensionWindow = value;
        emit ExtensionWindowSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function setMinIncrementBps(uint16 value) external {
        _onlyUpgradeAuthority();
        if (value < _MIN_INCREMENT_BPS || value > _MAX_INCREMENT_BPS) revert BadConfig();
        uint16 previous = minIncrementBps;
        minIncrementBps = value;
        emit MinIncrementBpsSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function setMinDuration(uint40 value) external {
        _onlyUpgradeAuthority();
        if (value > maxDuration) revert BadConfig();
        uint40 previous = minDuration;
        minDuration = value;
        emit MinDurationSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function setMaxDuration(uint40 value) external {
        _onlyUpgradeAuthority();
        if (value < minDuration) revert BadConfig();
        uint40 previous = maxDuration;
        maxDuration = value;
        emit MaxDurationSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function setSettlementHold(uint40 value) external {
        _onlyUpgradeAuthority();
        if (value == 0) revert BadConfig();
        uint40 previous = settlementHold;
        settlementHold = value;
        emit SettlementHoldSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function setSettlementDisputeBond(uint128 value) external {
        _onlyUpgradeAuthority();
        if (value == 0) revert BadConfig();
        uint128 previous = settlementDisputeBond;
        settlementDisputeBond = value;
        emit SettlementDisputeBondSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function setDisputeResolutionTimeout(uint40 value) external {
        _onlyUpgradeAuthority();
        if (value == 0) revert BadConfig();
        uint40 previous = disputeResolutionTimeout;
        disputeResolutionTimeout = value;
        emit DisputeResolutionTimeoutSet(previous, value);
    }

    /// @inheritdoc IAuctionEscrow
    function transferUpgradeAuthority(address newAuthority) external {
        if (msg.sender != upgradeAuthority) revert NotUpgradeAuthority();
        if (newAuthority == address(0)) revert ZeroAddress();
        address previous = upgradeAuthority;
        upgradeAuthority = newAuthority;
        emit UpgradeAuthorityTransferred(previous, newAuthority);
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        revert DirectEthNotAccepted();
    }

    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != upgradeAuthority) revert NotUpgradeAuthority();
    }

    function _onlyUpgradeAuthority() internal view {
        if (msg.sender != upgradeAuthority) revert NotUpgradeAuthority();
    }

    function _validateAsset(address asset) internal view {
        if (asset != address(0) && asset != address(usdc)) revert UnsupportedAsset();
    }

    function _requirePassportVerified(uint256 tokenId) internal view {
        uint8 status = IKarPassportAuction(address(karPassport)).passportStatus(tokenId);
        if (status == _STATUS_DISPUTED) revert PassportDisputed();
        if (status != _STATUS_VERIFIED) revert PassportNotVerified();
    }

    function _checkOwnerMinAtReserve(uint128 reserve, uint16 agentFeeBps, uint128 ownerMinAsset) internal view {
        uint256 agentFee = (uint256(reserve) * agentFeeBps) / 10_000;
        uint256 platformFee = (uint256(reserve) * platformFeeBps) / 10_000;
        if (uint256(reserve) - agentFee - platformFee < ownerMinAsset) revert BelowOwnerMinAsset();
    }

    function _writeAuction(
        uint256 tokenId,
        address seller,
        address agent,
        uint16 agentFeeBps,
        address asset,
        uint128 reserve,
        uint128 ownerMinAsset,
        uint40 duration
    ) internal {
        auctions[tokenId] = Auction({
            seller: seller,
            agent: agent,
            agentFeeBps: agentFeeBps,
            asset: asset,
            reserve: reserve,
            ownerMinAsset: ownerMinAsset,
            duration: duration,
            startedAt: 0,
            endsAt: 0,
            highestBidder: address(0),
            highestBid: 0,
            active: true
        });
        emit AuctionCreated(tokenId, seller, agent, asset, reserve, duration, agentFeeBps);
    }

    function _pullBidFunds(address asset, uint128 amount) internal {
        if (asset == address(0)) {
            if (msg.value != amount) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            usdc.safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _applyExtension(Auction storage a) internal {
        if (block.timestamp + extensionWindow >= a.endsAt) {
            uint40 extended = uint40(block.timestamp + extensionWindow);
            if (extended > a.endsAt) {
                a.endsAt = extended;
            }
        }
    }

    function _refundBidder(uint256 tokenId, address bidder, uint128 amount, address asset) internal {
        if (asset == address(0)) {
            bool wrapped = _safeTransferETHWithFallback(bidder, amount);
            emit BidRefunded(tokenId, bidder, amount, wrapped);
        } else {
            usdc.safeTransfer(bidder, amount);
            emit BidRefunded(tokenId, bidder, amount, false);
        }
    }

    /// @dev Nouns-style native transfer with WETH fallback on receive failure.
    function _safeTransferETHWithFallback(address to, uint256 amount) internal returns (bool wrapped) {
        (bool ok,) = payable(to).call{gas: _ETH_TRANSFER_GAS, value: amount}("");
        if (ok) return false;

        wrappedNative.deposit{value: amount}();
        if (!wrappedNative.transfer(to, amount)) revert TransferFailed();
        return true;
    }

    function _cancelAuction(uint256 tokenId, address by) internal {
        Auction storage a = auctions[tokenId];
        address seller = a.seller;
        a.active = false;
        _clearAuctionStorage(tokenId);
        karPassport.safeTransferFrom(address(this), seller, tokenId);
        emit AuctionCancelled(tokenId, by);
    }

    function _computeFees(uint128 gross, uint16 agentFeeBps, address agent)
        internal
        view
        returns (uint128 agentFee, uint128 platformFee, uint128 net)
    {
        agentFee = agent == address(0) ? 0 : uint128((uint256(gross) * agentFeeBps) / 10_000);
        platformFee = uint128((uint256(gross) * platformFeeBps) / 10_000);
        net = gross - agentFee - platformFee;
    }

    function _payout(uint256 tokenId, bool autoRelease, address bondRecipient, uint128 bondAmount) internal {
        SettlementHold storage h = holds[tokenId];
        if (h.releaseAt == 0) revert NoHold();

        Auction storage a = auctions[tokenId];
        address seller = a.seller;
        address agent = a.agent;
        uint16 agentFeeBps = a.agentFeeBps;
        address asset = a.asset;
        uint128 gross = h.gross;

        (uint128 agentFee, uint128 platformFee, uint128 net) = _computeFees(gross, agentFeeBps, agent);

        delete holds[tokenId];
        _clearAuctionStorage(tokenId);

        if (asset == address(0)) {
            if (platformFee > 0) _safeTransferETHWithFallback(platformRecipient, platformFee);
            if (agentFee > 0) _safeTransferETHWithFallback(agent, agentFee);
            if (net > 0) _safeTransferETHWithFallback(seller, net);
            if (bondAmount > 0 && bondRecipient != address(0)) {
                _safeTransferETHWithFallback(bondRecipient, bondAmount);
            }
        } else {
            if (platformFee > 0) usdc.safeTransfer(platformRecipient, platformFee);
            if (agentFee > 0) usdc.safeTransfer(agent, agentFee);
            if (net > 0) usdc.safeTransfer(seller, net);
            if (bondAmount > 0 && bondRecipient != address(0)) {
                _safeTransferETHWithFallback(bondRecipient, bondAmount);
            }
        }

        emit FundsReleased(tokenId, gross, platformFee, agentFee, net, autoRelease);
    }

    function _clearAuctionStorage(uint256 tokenId) internal {
        delete returnRequestedAt[tokenId];
        delete auctionAgentAuthorizations[tokenId];
        auctions[tokenId].seller = address(0);
        auctions[tokenId].agent = address(0);
        auctions[tokenId].agentFeeBps = 0;
        auctions[tokenId].asset = address(0);
        auctions[tokenId].reserve = 0;
        auctions[tokenId].ownerMinAsset = 0;
        auctions[tokenId].duration = 0;
        auctions[tokenId].startedAt = 0;
        auctions[tokenId].endsAt = 0;
        auctions[tokenId].highestBidder = address(0);
        auctions[tokenId].highestBid = 0;
        auctions[tokenId].active = false;
    }
}
