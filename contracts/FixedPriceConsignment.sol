// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IKarPassportEncumbrance} from "./interfaces/IKarPassportEncumbrance.sol";
import {ConsignmentBase} from "./lib/ConsignmentBase.sol";
import {Erc20Admission} from "./lib/Erc20Admission.sol";

/**
 * @title FixedPriceConsignment
 * @notice Fixed-price selling mode: stated price (asset or fiat), on-chain buy, external confirmation.
 *
 * @dev Spec: docs/research/commerce-model-2026.md §3.2, §4.0–§4.5, §5.1, §11 G3/G4, §13a.5.
 *      UUPS; owner = timelock; guardian pauses (G3). Pause gates open (base) + buy only.
 *      No verifier-admission gate (N2). No HELD / protection window. External path moves no money (C7 / R4).
 */
contract FixedPriceConsignment is ConsignmentBase, UUPSUpgradeable, IERC721Receiver, IKarPassportEncumbrance {
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.1.0-rc.1";

    bytes32 public constant CURRENCY_USD = bytes32("USD");

    uint256 internal constant _FIAT_SCALE = 1e8;

    IERC721 public karPassport;
    AggregatorV3Interface public nativeUsdFeed;
    uint256 public maxFeedStaleness;

    struct PaymentTokenConfig {
        address feed;
        uint8 decimals;
        bool enabled;
    }

    mapping(address token => PaymentTokenConfig) public paymentTokens;
    mapping(bytes32 currencyCode => address feed) public currencyFeeds;
    mapping(uint256 tokenId => bytes) public settlementNotes;

    /// @dev ClaimablePayouts owns its own `__gap`. Child reserve for this contract's slots.
    uint256[48] private __gap;

    error WrongValue();
    error StalePrice();
    error BadOracleAnswer();
    error EmptySettlementNote();
    error PaymentTokenNotSupported();
    error ZeroFeedStaleness();
    error InvalidFeed();
    error InvalidFeedDecimals();
    error InvalidCurrencyCode();
    error CurrencyNotAvailableOnChain();
    error DirectEthNotAccepted();
    error NotSellerOrAgent();

    event PaymentTokenApproved(address indexed token, address feed, uint8 decimals);
    event PaymentTokenRevoked(address indexed token);
    event CurrencyFeedSet(bytes32 indexed currencyCode, address feed);
    event MaxFeedStalenessSet(uint256 previous, uint256 current);
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
        uint256 maxFeedStaleness_,
        address initialOwner_,
        address guardian_
    ) external initializer {
        if (passport_ == address(0) || nativeUsdFeed_ == address(0)) revert ZeroAddress();
        if (maxFeedStaleness_ == 0) revert ZeroFeedStaleness();

        __ConsignmentBase_init(platformRecipient_, feeBps_, initialOwner_, guardian_);

        karPassport = IERC721(passport_);
        nativeUsdFeed = AggregatorV3Interface(nativeUsdFeed_);
        maxFeedStaleness = maxFeedStaleness_;
        _validateFeed(nativeUsdFeed_);
    }

    // ---- Admin ----

    function approvePaymentToken(address token, address feed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        Erc20Admission.requireConforming(token);
        uint8 decimals_ = Erc20Admission.requireDecimals(token);
        if (feed != address(0)) _validateFeed(feed);
        paymentTokens[token] = PaymentTokenConfig({feed: feed, decimals: decimals_, enabled: true});
        emit PaymentTokenApproved(token, feed, decimals_);
    }

    function revokePaymentToken(address token) external onlyOwner {
        delete paymentTokens[token];
        emit PaymentTokenRevoked(token);
    }

    function setCurrencyFeed(bytes32 currencyCode, address feed) external onlyOwner {
        if (currencyCode == CURRENCY_USD) revert InvalidCurrencyCode();
        if (feed == address(0)) {
            delete currencyFeeds[currencyCode];
        } else {
            _validateFeed(feed);
            currencyFeeds[currencyCode] = feed;
        }
        emit CurrencyFeedSet(currencyCode, feed);
    }

    /// @dev Live at quote/buy (oracle freshness is environmental). Rejects zero (G2).
    function setMaxFeedStaleness(uint256 maxFeedStaleness_) external onlyOwner {
        if (maxFeedStaleness_ == 0) revert ZeroFeedStaleness();
        uint256 previous = maxFeedStaleness;
        maxFeedStaleness = maxFeedStaleness_;
        emit MaxFeedStalenessSet(previous, maxFeedStaleness_);
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
            PaymentTokenConfig memory cfg = paymentTokens[asset];
            if (!cfg.enabled) revert PaymentTokenNotSupported();
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

    /// @inheritdoc IKarPassportEncumbrance
    /// @dev Live consignment forbids both intents (listed survival for LeaveChain; open mutex).
    function may(uint256 tokenId, Intent intent) external view override returns (bool) {
        intent;
        return !isLiveConsignment(tokenId);
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
            if (asset != address(0)) {
                PaymentTokenConfig memory cfg = paymentTokens[asset];
                if (!cfg.enabled) revert PaymentTokenNotSupported();
            }
            return uint256(price);
        }
        uint256 usd1e8 = _fiatToUsd1e8(price, denom.currencyCode);
        if (asset == address(0)) {
            return _usdToNative(usd1e8);
        }
        {
            PaymentTokenConfig memory cfg = paymentTokens[asset];
            if (!cfg.enabled) revert PaymentTokenNotSupported();
            return _usdToTokenAmount(usd1e8, cfg);
        }
    }

    function _fiatToUsd1e8(uint128 fiatPrice1e8, bytes32 currencyCode) private view returns (uint256) {
        if (currencyCode == CURRENCY_USD) {
            return uint256(fiatPrice1e8);
        }
        address feed = currencyFeeds[currencyCode];
        if (feed == address(0)) revert CurrencyNotAvailableOnChain();
        (, int256 rate,, uint256 upd,) = AggregatorV3Interface(feed).latestRoundData();
        _checkFeedFresh(upd);
        if (rate <= 0) revert BadOracleAnswer();
        return (uint256(fiatPrice1e8) * uint256(rate)) / _FIAT_SCALE;
    }

    function _usdToNative(uint256 usd1e8) private view returns (uint256) {
        (, int256 px,, uint256 upd,) = nativeUsdFeed.latestRoundData();
        _checkFeedFresh(upd);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * 1e18) / uint256(px);
    }

    function _usdToTokenAmount(uint256 usd1e8, PaymentTokenConfig memory cfg) private view returns (uint256) {
        uint256 scale = 10 ** uint256(cfg.decimals);
        if (cfg.feed == address(0)) {
            return (usd1e8 * scale) / _FIAT_SCALE;
        }
        (, int256 px,, uint256 upd,) = AggregatorV3Interface(cfg.feed).latestRoundData();
        _checkFeedFresh(upd);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * scale) / uint256(px);
    }

    function _validateFeed(address feed) private view {
        if (feed.code.length == 0) revert InvalidFeed();
        AggregatorV3Interface agg = AggregatorV3Interface(feed);
        if (agg.decimals() != 8) revert InvalidFeedDecimals();
        (, int256 answer,, uint256 updatedAt,) = agg.latestRoundData();
        if (answer <= 0) revert BadOracleAnswer();
        _checkFeedFresh(updatedAt);
    }

    function _checkFeedFresh(uint256 updatedAt) private view {
        if (block.timestamp - updatedAt > maxFeedStaleness) revert StalePrice();
    }
}
