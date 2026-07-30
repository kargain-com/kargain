// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IEncumbranceRegistry} from "./interfaces/IEncumbranceRegistry.sol";
import {IKarPassportEncumbrance} from "./interfaces/IKarPassportEncumbrance.sol";
import {ConsignmentBase} from "./lib/ConsignmentBase.sol";
import {Erc20Admission} from "./lib/Erc20Admission.sol";

/**
 * @title FixedPriceConsignment
 * @notice Fixed-price selling mode: stated price (asset or fiat), on-chain buy, external confirmation.
 *
 * @dev Spec: docs/research/commerce-model-2026.md §3.2, §4.0–§4.5, §5.1, §11 G3/G4, §13a.5.
 *      UUPS; owner = timelock after Nuclear handoff; guardian pauses and may revoke payment tokens (G3).
 *      Pause gates open (base) + buy only. Payment admission is checked at open; in-flight buy uses
 *      retained config even after soft revoke. No verifier-admission gate (N2). No HELD / protection
 *      window. External path moves no money (C7 / R4).
 *
 *      Oracle freshness is per feed: each admitted feed carries its own `stalenessTolerance`
 *      (seconds). Stablecoin/FX aggregators have long heartbeats; ETH/USD does not. A single global
 *      bound cannot serve both.
 */
contract FixedPriceConsignment is ConsignmentBase, UUPSUpgradeable, IERC721Receiver, IKarPassportEncumbrance {
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.3.0-rc.1";

    bytes32 public constant CURRENCY_USD = bytes32("USD");

    /// @dev Below this, block-time / RPC skew dominate; admission refuses.
    uint32 public constant MIN_FEED_STALENESS = 60;
    /// @dev Upper governance bound for per-feed tolerances. Must admit
    ///      `FEED_STALENESS_MULTIPLIER × max(observedMaxGap, publishedHeartbeat)` for daily-heartbeat
    ///      feeds (see commerce-model P4). 72h = room for 2× ~24h with observation overshoot;
    ///      48h was exactly 2×86400 with zero slack when observed gap exceeds published heartbeat.
    uint32 public constant MAX_FEED_STALENESS = 259_200; // 72 hours

    uint256 internal constant _FIAT_SCALE = 1e8;

    IERC721 public karPassport;
    AggregatorV3Interface public nativeUsdFeed;
    /// @notice Freshness window (seconds) for `nativeUsdFeed` only — not a global default for other feeds.
    uint32 public nativeUsdStalenessTolerance;

    struct PaymentTokenConfig {
        address feed;
        uint8 decimals;
        bool enabled;
        /// @dev Seconds; must be 0 when `feed == address(0)`, else within MIN/MAX and validated at admit.
        uint32 stalenessTolerance;
    }

    struct CurrencyFeedConfig {
        address feed;
        uint32 stalenessTolerance;
    }

    mapping(address token => PaymentTokenConfig) public paymentTokens;
    mapping(bytes32 currencyCode => CurrencyFeedConfig) public currencyFeeds;
    mapping(uint256 tokenId => bytes) public settlementNotes;

    /// @dev ClaimablePayouts owns its own `__gap`. Child reserve for this contract's slots.
    uint256[48] private __gap;

    error WrongValue();
    error StalePrice();
    error BadOracleAnswer();
    error EmptySettlementNote();
    error PaymentTokenNotSupported();
    /// @dev Fiat + ERC-20 requires a measured payment-token feed (open and quote/buy).
    error PaymentTokenFeedRequired();
    /// @dev Re-admission cannot clear a non-zero payment-token feed (monotonic).
    error CannotClearPaymentTokenFeed();
    /// @dev Non-zero feed with zero tolerance.
    error ZeroFeedStaleness();
    /// @dev Zero feed with non-zero tolerance (tolerance only attaches to a feed).
    error StalenessWithoutFeed();
    /// @dev Tolerance outside [MIN_FEED_STALENESS, MAX_FEED_STALENESS].
    error FeedStalenessOutOfBounds();
    error InvalidFeed();
    error InvalidFeedDecimals();
    error InvalidCurrencyCode();
    error CurrencyNotAvailableOnChain();
    error DirectEthNotAccepted();
    error NotSellerOrAgent();

    event PaymentTokenApproved(address indexed token, address feed, uint8 decimals, uint32 stalenessTolerance);
    event PaymentTokenRevoked(address indexed token);
    event CurrencyFeedSet(bytes32 indexed currencyCode, address feed, uint32 stalenessTolerance);
    event NativeUsdStalenessToleranceSet(uint32 previous, uint32 current);
    event Bought(uint256 indexed tokenId, address indexed buyer, address indexed asset, uint256 amount);
    event SettlementNoteSet(uint256 indexed tokenId, address indexed setter);
    event ExternalPaymentConfirmed(uint256 indexed tokenId, address indexed buyer, address indexed confirmer);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address passport_,
        address platformRecipient_,
        uint256 feeBps_,
        address nativeUsdFeed_,
        uint32 nativeUsdStalenessTolerance_,
        address initialOwner_,
        address guardian_
    ) external initializer {
        if (passport_ == address(0) || nativeUsdFeed_ == address(0)) revert ZeroAddress();

        __ConsignmentBase_init(platformRecipient_, feeBps_, initialOwner_, guardian_);

        karPassport = IERC721(passport_);
        nativeUsdFeed = AggregatorV3Interface(nativeUsdFeed_);
        nativeUsdStalenessTolerance = nativeUsdStalenessTolerance_;
        _validateFeed(nativeUsdFeed_, nativeUsdStalenessTolerance_);
    }

    // ---- Admin ----

    /// @notice Admit an ERC-20 for fixed-price settlement.
    /// @param token Conforming ERC-20 with readable `decimals` (EOA / broken decimals refused).
    /// @param feed Chainlink USD aggregator, or `address(0)` for **asset-denominated sales only**
    ///             (seller names token amount; no conversion). Fiat opens require a non-zero feed.
    ///             Non-zero feeds must pass `_validateFeed` (code, 8 decimals, positive answer, fresh
    ///             within `stalenessTolerance_`). Once a non-zero feed is set it cannot be cleared
    ///             by re-admission (monotonic).
    /// @param stalenessTolerance_ Seconds of allowed age for this feed. Must be 0 iff `feed == 0`;
    ///        otherwise within governance [MIN_FEED_STALENESS, MAX_FEED_STALENESS].
    function approvePaymentToken(address token, address feed, uint32 stalenessTolerance_) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        Erc20Admission.requireConforming(token);
        uint8 decimals_ = Erc20Admission.requireDecimals(token);
        if (paymentTokens[token].feed != address(0) && feed == address(0)) {
            revert CannotClearPaymentTokenFeed();
        }
        if (feed == address(0)) {
            if (stalenessTolerance_ != 0) revert StalenessWithoutFeed();
        } else {
            _validateFeed(feed, stalenessTolerance_);
        }
        paymentTokens[token] = PaymentTokenConfig({
            feed: feed,
            decimals: decimals_,
            enabled: true,
            stalenessTolerance: stalenessTolerance_
        });
        emit PaymentTokenApproved(token, feed, decimals_, stalenessTolerance_);
    }

    /// @notice Soft-disable a payment token (G3 reduce-exposure). Guardian or owner.
    /// @dev Keeps decimals/feed/tolerance so consignments already open in this asset can still quote and buy.
    function revokePaymentToken(address token) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        paymentTokens[token].enabled = false;
        emit PaymentTokenRevoked(token);
    }

    /// @notice Set or clear a non-USD fiat currency feed with its own freshness tolerance.
    function setCurrencyFeed(bytes32 currencyCode, address feed, uint32 stalenessTolerance_) external onlyOwner {
        if (currencyCode == CURRENCY_USD) revert InvalidCurrencyCode();
        if (feed == address(0)) {
            if (stalenessTolerance_ != 0) revert StalenessWithoutFeed();
            delete currencyFeeds[currencyCode];
        } else {
            _validateFeed(feed, stalenessTolerance_);
            currencyFeeds[currencyCode] =
                CurrencyFeedConfig({feed: feed, stalenessTolerance: stalenessTolerance_});
        }
        emit CurrencyFeedSet(currencyCode, feed, stalenessTolerance_);
    }

    /// @notice Retune freshness for the native USD feed only (does not affect payment/currency feeds).
    function setNativeUsdStalenessTolerance(uint32 nativeUsdStalenessTolerance_) external onlyOwner {
        _requireStalenessInBounds(nativeUsdStalenessTolerance_);
        (, int256 answer,, uint256 updatedAt,) = nativeUsdFeed.latestRoundData();
        if (answer <= 0) revert BadOracleAnswer();
        _checkFeedFresh(updatedAt, nativeUsdStalenessTolerance_);
        uint32 previous = nativeUsdStalenessTolerance;
        nativeUsdStalenessTolerance = nativeUsdStalenessTolerance_;
        emit NativeUsdStalenessToleranceSet(previous, nativeUsdStalenessTolerance_);
    }

    // ---- Views ----

    function consignmentAssetOf(uint256 tokenId) external view returns (address) {
        return _consignments[tokenId].asset;
    }

    function consignmentDenominationOf(uint256 tokenId)
        external
        view
        returns (DenominationKind kind, bytes32 currencyCode)
    {
        Denomination memory d = _consignments[tokenId].denomination;
        return (d.kind, d.currencyCode);
    }

    /// @notice Settlement-asset units required to buy. Asset denom = price; fiat denom converts at payment time.
    function quoteBuy(uint256 tokenId) public view returns (uint256) {
        if (!isLiveConsignment(tokenId)) revert NoLiveConsignment();
        Consignment storage c = _consignments[tokenId];
        return _quoteAmount(c.price, c.denomination, c.asset);
    }

    // ---- Purchase (on-chain) ----

    function buy(uint256 tokenId) external payable nonReentrant {
        _requireNotPaused();
        _requireOfferedForSale(tokenId);
        Consignment storage c = _consignments[tokenId];
        uint256 amount = _quoteAmount(c.price, c.denomination, c.asset);
        address asset = c.asset;

        if (asset == address(0)) {
            if (msg.value != amount) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            // Admission was checked at open; soft-revoked tokens must still settle in-flight sales.
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }

        if (c.denomination.kind == DenominationKind.Fiat && c.agent != address(0) && c.floor != 0) {
            uint256 floorAsset = _quoteAmount(c.floor, c.denomination, asset);
            if (floorAsset > type(uint128).max) revert BadOracleAnswer();
            _setSnapshotFloor(tokenId, uint128(floorAsset));
        }

        address buyer = msg.sender;
        _releaseCustody(tokenId, buyer);
        emit Bought(tokenId, buyer, asset, amount);
        _paySplit(tokenId, amount, CloseReason.Sold);
    }

    // ---- External confirmation (C7 / R4) — never paused ----

    function setSettlementNote(uint256 tokenId, bytes calldata note) external nonReentrant {
        _requireOfferedForSale(tokenId);
        Consignment storage c = _consignments[tokenId];
        if (c.agent == address(0)) {
            if (c.seller != msg.sender) revert NotConsignmentSeller();
        } else if (c.agent != msg.sender) {
            revert NotConsignmentRunner();
        }
        if (note.length == 0) revert EmptySettlementNote();
        settlementNotes[tokenId] = note;
        emit SettlementNoteSet(tokenId, msg.sender);
    }

    function confirmExternalPayment(uint256 tokenId, address buyer) external nonReentrant {
        _requireOfferedForSale(tokenId);
        Consignment storage c = _consignments[tokenId];
        if (msg.sender != c.seller && msg.sender != c.agent) revert NotSellerOrAgent();
        bytes memory note = settlementNotes[tokenId];
        if (note.length == 0) revert EmptySettlementNote();
        if (buyer == address(0)) revert ZeroAddress();

        delete settlementNotes[tokenId];
        _releaseCustody(tokenId, buyer);
        emit ExternalPaymentConfirmed(tokenId, buyer, msg.sender);
        // No _paySplit, no floor check, no money movement (C7 / R4).
        _close(tokenId, CloseReason.ExternalConfirmed);
    }

    // ---- UUPS ----

    function _authorizeUpgrade(address) internal view override onlyOwner {}

    // ---- Instance hooks ----

    function isEscrowApproved(uint256 tokenId, address owner_) internal view override returns (bool) {
        return karPassport.getApproved(tokenId) == address(this) || karPassport.isApprovedForAll(owner_, address(this));
    }

    function passportOwner(uint256 tokenId) internal view override returns (address) {
        return karPassport.ownerOf(tokenId);
    }

    function _may(uint256 tokenId, IKarPassportEncumbrance.Intent intent) internal view override returns (bool) {
        return IKarPassportEncumbrance(address(karPassport)).may(tokenId, intent);
    }

    function _isSelfEncumbranceSource() internal view override returns (bool) {
        return IEncumbranceRegistry(address(karPassport)).isEncumbranceSource(address(this));
    }

    /// @inheritdoc IKarPassportEncumbrance
    /// @dev Live consignment forbids both intents (listed survival for LeaveChain; open mutex).
    function may(uint256 tokenId, Intent intent) external view override returns (bool) {
        intent;
        return !isLiveConsignment(tokenId);
    }

    function _requireModeOpen(
        uint256, /*tokenId*/
        address, /*runner*/
        Denomination memory denomination,
        address asset
    ) internal view override {
        if (asset != address(0) && !paymentTokens[asset].enabled) revert PaymentTokenNotSupported();
        if (
            denomination.kind == DenominationKind.Fiat && asset != address(0)
                && paymentTokens[asset].feed == address(0)
        ) {
            revert PaymentTokenFeedRequired();
        }
    }

    function _takeCustody(uint256 tokenId, address from) internal override {
        karPassport.transferFrom(from, address(this), tokenId);
    }

    function _releaseCustody(uint256 tokenId, address to) internal override {
        karPassport.safeTransferFrom(address(this), to, tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        revert DirectEthNotAccepted();
    }

    // ---- Internals ----

    function _requireOfferedForSale(uint256 tokenId) private view {
        if (_phase[tokenId] != Phase.Offered || _committedNotOffered[tokenId]) revert NotOffered();
    }

    function _quoteAmount(uint128 price, Denomination memory denom, address asset) private view returns (uint256) {
        if (denom.kind == DenominationKind.Asset) {
            return uint256(price);
        }
        uint256 usd1e8 = _fiatToUsd1e8(price, denom.currencyCode);
        if (asset == address(0)) {
            return _usdToNative(usd1e8);
        }
        // Soft-revoke keeps decimals/feed/tolerance so in-flight fiat quotes still resolve.
        return _usdToTokenAmount(usd1e8, paymentTokens[asset]);
    }

    function _fiatToUsd1e8(uint128 fiatPrice1e8, bytes32 currencyCode) private view returns (uint256) {
        if (currencyCode == CURRENCY_USD) {
            return uint256(fiatPrice1e8);
        }
        CurrencyFeedConfig memory cfg = currencyFeeds[currencyCode];
        if (cfg.feed == address(0)) revert CurrencyNotAvailableOnChain();
        (, int256 rate,, uint256 upd,) = AggregatorV3Interface(cfg.feed).latestRoundData();
        _checkFeedFresh(upd, cfg.stalenessTolerance);
        if (rate <= 0) revert BadOracleAnswer();
        return (uint256(fiatPrice1e8) * uint256(rate)) / _FIAT_SCALE;
    }

    function _usdToNative(uint256 usd1e8) private view returns (uint256) {
        (, int256 px,, uint256 upd,) = nativeUsdFeed.latestRoundData();
        _checkFeedFresh(upd, nativeUsdStalenessTolerance);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * 1e18) / uint256(px);
    }

    /// @dev Fiat ERC-20 conversion requires a measured feed (P4). No parity assumption.
    function _usdToTokenAmount(uint256 usd1e8, PaymentTokenConfig memory cfg) private view returns (uint256) {
        if (cfg.feed == address(0)) revert PaymentTokenFeedRequired();
        uint256 scale = 10 ** uint256(cfg.decimals);
        (, int256 px,, uint256 upd,) = AggregatorV3Interface(cfg.feed).latestRoundData();
        _checkFeedFresh(upd, cfg.stalenessTolerance);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * scale) / uint256(px);
    }

    function _requireStalenessInBounds(uint32 stalenessTolerance_) private pure {
        if (stalenessTolerance_ < MIN_FEED_STALENESS || stalenessTolerance_ > MAX_FEED_STALENESS) {
            revert FeedStalenessOutOfBounds();
        }
    }

    function _validateFeed(address feed, uint32 stalenessTolerance_) private view {
        if (stalenessTolerance_ == 0) revert ZeroFeedStaleness();
        _requireStalenessInBounds(stalenessTolerance_);
        if (feed.code.length == 0) revert InvalidFeed();
        AggregatorV3Interface agg = AggregatorV3Interface(feed);
        if (agg.decimals() != 8) revert InvalidFeedDecimals();
        (, int256 answer,, uint256 updatedAt,) = agg.latestRoundData();
        if (answer <= 0) revert BadOracleAnswer();
        _checkFeedFresh(updatedAt, stalenessTolerance_);
    }

    function _checkFeedFresh(uint256 updatedAt, uint32 stalenessTolerance_) private view {
        if (block.timestamp - updatedAt > stalenessTolerance_) revert StalePrice();
    }
}
