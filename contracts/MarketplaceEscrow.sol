// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Version policy:
//   PATCH (Z): bug fixes that do not change ABI or storage layout
//   MINOR (Y): new functions added, backward compatible
//   MAJOR (X): breaking ABI changes, storage layout changes,
//               or fundamental behavior change
//   Pre-release: -rc.N for release candidates, remove on mainnet deploy
//   Immutable contracts (KarPassport, KarProPass, KarProStaking):
//     any change = new deployment = bump MINOR or MAJOR
//   Upgradeable contracts (MarketplaceEscrow):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IMarketplaceEscrow} from "./interfaces/IMarketplaceEscrow.sol";
import {ClaimablePayouts} from "./lib/ClaimablePayouts.sol";
import {Erc20Admission} from "./lib/Erc20Admission.sol";

interface IKarProStaking {
    function isActiveVerifier(address a) external view returns (bool);
}

/// @title MarketplaceEscrow
/// @notice KarPassport escrow with dynamic fiat currencies, agent consignment, and multi-token checkout.
/// @dev UUPS upgradeable; timelock is upgrade authority. v2 fresh proxy deployment.
///      Settlement legs use ClaimablePayouts — recipients that cannot accept funds get a withdrawable claim.
/// @custom:version 2.1.0-rc.2
contract MarketplaceEscrow is IMarketplaceEscrow, IERC721Receiver, ClaimablePayouts, ReentrancyGuard, Initializable, UUPSUpgradeable {
    string public constant VERSION = "2.1.0-rc.2";

    using SafeERC20 for IERC20;

    bytes32 public constant CURRENCY_USD = bytes32("USD");
    bytes32 public constant CURRENCY_NATIVE = bytes32("NATIVE");

    uint256 internal constant _FIAT_SCALE = 1e8;
    uint256 internal constant _MAX_FEE_BPS = 1000;
    uint256 internal constant _MAX_AGENT_FEE_BPS = 3000;
    uint256 internal constant _RETURN_COOLDOWN = 7 days;

    IERC721 public immutable karPassport;
    AggregatorV3Interface public immutable nativeUsdFeed;
    address public immutable karProStaking;
    address public immutable platformRecipient;
    uint16 public immutable platformFeeBps;
    uint256 public immutable proFeeBps;
    uint256 public immutable maxFeedStaleness;

    address public upgradeAuthority;
    bool public paused;

    struct Listing {
        address seller;
        uint128 fiatPrice1e8;
        bool active;
        address agent;
        uint128 ownerMinPrice1e8;
        uint16 agentFeeBps;
        bytes32 currencyCode;
    }

    struct AgentAuth {
        address agent;
        uint64 expiry;
        uint128 ownerMinPrice1e8;
        bool active;
    }

    struct PaymentTokenConfig {
        address feed;
        bool enabled;
    }

    mapping(uint256 tokenId => Listing) public listings;
    mapping(uint256 tokenId => AgentAuth) public agentAuthorizations;
    mapping(uint256 tokenId => uint256) public returnRequestedAt;
    mapping(uint256 tokenId => bytes) public settlementNotes;
    mapping(bytes32 currencyCode => address feed) public currencyFeeds;
    mapping(address token => PaymentTokenConfig) public paymentTokens;

    /// @dev UUPS storage reserve (pre-claim convention). ClaimablePayouts owns its own `__gap`.
    uint256[48] private __gap;

    event Listed(
        uint256 indexed tokenId,
        address indexed seller,
        uint128 fiatPrice1e8,
        bytes32 currencyCode,
        address agent,
        uint16 agentFeeBps
    );
    event Delisted(uint256 indexed tokenId, address indexed seller);
    event AgentAuthorized(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed agent,
        uint64 expiry,
        uint128 ownerMinPrice1e8
    );
    event AgentRevoked(uint256 indexed tokenId, address indexed owner);
    event ListingUpdated(uint256 indexed tokenId, uint128 newPrice, uint16 newAgentFeeBps);
    event OwnerMinPriceUpdated(uint256 indexed tokenId, uint128 newMin);
    event ReturnRequested(uint256 indexed tokenId, address indexed owner);
    event AgentDelisted(uint256 indexed tokenId, address indexed agent);
    event ForceReturn(uint256 indexed tokenId, address indexed owner);
    event Sale(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 gross,
        uint256 platformFee,
        uint256 agentFee,
        uint256 netToSeller,
        address payToken,
        address agent
    );
    event SettlementNoteSet(uint256 indexed tokenId, address indexed seller);
    event ExternalPaymentConfirmed(uint256 indexed tokenId, address indexed buyer, address indexed confirmer);
    event CurrencyFeedSet(bytes32 indexed currencyCode, address feed);
    event CurrencyFeedRevoked(bytes32 indexed currencyCode);
    event PaymentTokenApproved(address indexed token, address feed);
    event PaymentTokenRevoked(address indexed token);
    event Paused(bool paused);
    event UpgradeAuthorityTransferred(address indexed previous, address indexed next);

    error NotSeller();
    error NotSellerOrAgent();
    error NotAgent();
    error NoAgent();
    error NotOwner();
    error NotActive();
    error AlreadyListed();
    error BadPrice();
    error WrongValue();
    error FeeTooHigh();
    error AgentFeeTooHigh();
    error StalePrice();
    error BadOracleAnswer();
    error ZeroAddress();
    error NotUpgradeAuthority();
    error CurrencyNotAvailableOnChain();
    error InvalidCurrencyCode();
    error InvalidFeed();
    error InvalidFeedDecimals();
    error BelowOwnerMinPrice();
    error AgentNotAuthorized();
    error EscrowNotApproved();
    error ReturnNotRequested();
    error ReturnAlreadyRequested();
    error ReturnCooldownPending();
    error EmptySettlementNote();
    error PaymentTokenNotSupported();
    error ContractPaused();
    error DirectEthNotAccepted();
    error CannotRaiseMinPrice();
    error ListingHasAgent();

    /// @custom:oz-upgrades-unsafe-allow constructor
    /// @dev platformRecipient_ is immutable. Recipients that cannot accept funds accrue a withdrawable claim.
    ///      ERC-20 payment tokens enter only via `approvePaymentToken` (admission there).
    constructor(
        address karPassport_,
        address nativeUsdFeed_,
        address karProStaking_,
        address platformRecipient_,
        uint256 feeBps_,
        uint256 proFeeBps_,
        uint256 maxFeedStaleness_
    ) {
        _disableInitializers();
        if (karPassport_ == address(0)) revert ZeroAddress();
        if (nativeUsdFeed_ == address(0)) revert ZeroAddress();
        if (platformRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > _MAX_FEE_BPS || proFeeBps_ > _MAX_FEE_BPS) revert FeeTooHigh();

        karPassport = IERC721(karPassport_);
        nativeUsdFeed = AggregatorV3Interface(nativeUsdFeed_);
        karProStaking = karProStaking_;
        platformRecipient = platformRecipient_;
        platformFeeBps = uint16(feeBps_);
        proFeeBps = proFeeBps_;
        maxFeedStaleness = maxFeedStaleness_;
    }

    /// @notice Proxy initializer; stores timelock (or deployer for genesis) as upgrade authority.
    /// @param timelockAddress_ Timelock or deployer EOA for genesis configuration.
    function initialize(address timelockAddress_) external initializer {
        if (timelockAddress_ == address(0)) revert ZeroAddress();
        upgradeAuthority = timelockAddress_;
    }

    /// @inheritdoc IMarketplaceEscrow
    function isListed(uint256 tokenId) external view returns (bool) {
        return listings[tokenId].active;
    }

    /// @notice Transfer upgrade authority to timelock after genesis configuration.
    /// @param newAuthority New upgrade authority (typically Timelock48h).
    function transferUpgradeAuthority(address newAuthority) external {
        if (msg.sender != upgradeAuthority) revert NotUpgradeAuthority();
        if (newAuthority == address(0)) revert ZeroAddress();
        address previous = upgradeAuthority;
        upgradeAuthority = newAuthority;
        emit UpgradeAuthorityTransferred(previous, newAuthority);
    }

    /// @notice Register or update a Chainlink XXX/USD feed for a listing currency.
    /// @param currencyCode ISO 4217 code as bytes32 (e.g. bytes32("EUR")).
    /// @param feed Chainlink aggregator proxy address.
    function setCurrencyFeed(bytes32 currencyCode, address feed) external {
        _onlyUpgradeAuthority();
        if (currencyCode == bytes32(0) || currencyCode == CURRENCY_NATIVE) revert InvalidCurrencyCode();
        _validateFeed(feed);
        currencyFeeds[currencyCode] = feed;
        emit CurrencyFeedSet(currencyCode, feed);
    }

    /// @notice Disable a listing currency on this chain.
    /// @param currencyCode ISO 4217 code as bytes32.
    function revokeCurrencyFeed(bytes32 currencyCode) external {
        _onlyUpgradeAuthority();
        delete currencyFeeds[currencyCode];
        emit CurrencyFeedRevoked(currencyCode);
    }

    /// @notice Approve an ERC-20 payment token; use address(0) feed for USD-pegged stables.
    /// @param token ERC-20 token address (address(0) reserved for native sentinel in quotes).
    /// @param feed Optional Chainlink feed for non-USD-pegged tokens.
    function approvePaymentToken(address token, address feed) external {
        _onlyUpgradeAuthority();
        if (token == address(0)) revert ZeroAddress();
        Erc20Admission.requireConforming(token);
        if (feed != address(0)) {
            _validateFeed(feed);
        }
        paymentTokens[token] = PaymentTokenConfig({feed: feed, enabled: true});
        emit PaymentTokenApproved(token, feed);
    }

    /// @notice Remove an approved payment token.
    /// @param token ERC-20 token address.
    function revokePaymentToken(address token) external {
        _onlyUpgradeAuthority();
        delete paymentTokens[token];
        emit PaymentTokenRevoked(token);
    }

    /// @notice Withdraw a pending native (`asset == address(0)`) or ERC-20 claim credited after a failed push.
    function withdrawClaim(address asset) external nonReentrant {
        _withdrawClaim(asset);
    }

    /// @notice Pause or unpause marketplace operations (via timelock).
    /// @param value True to pause list/buy flows.
    function setPaused(bool value) external {
        _onlyUpgradeAuthority();
        paused = value;
        emit Paused(value);
    }

    /// @notice Seller authorizes an agent to list on their behalf.
    /// @param tokenId Passport token id.
    /// @param agent Agent address.
    /// @param expiry Unix timestamp after which authorization expires; use 0 for no expiration.
    /// @param ownerMinPrice Minimum net-to-seller price in listing currency (1e8).
    function authorizeAgent(uint256 tokenId, address agent, uint64 expiry, uint128 ownerMinPrice)
        external
        nonReentrant
    {
        if (paused) revert ContractPaused();
        if (listings[tokenId].active) revert AlreadyListed();
        if (karPassport.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (agent == address(0)) revert ZeroAddress();

        if (
            karPassport.getApproved(tokenId) != address(this)
                && !karPassport.isApprovedForAll(msg.sender, address(this))
        ) {
            revert EscrowNotApproved();
        }

        agentAuthorizations[tokenId] =
            AgentAuth({agent: agent, expiry: expiry, ownerMinPrice1e8: ownerMinPrice, active: true});
        emit AgentAuthorized(tokenId, msg.sender, agent, expiry, ownerMinPrice);
    }

    /// @notice Seller revokes agent authorization when not actively listed.
    /// @param tokenId Passport token id.
    function revokeAgent(uint256 tokenId) external nonReentrant {
        if (listings[tokenId].active) revert AlreadyListed();
        if (karPassport.ownerOf(tokenId) != msg.sender) revert NotOwner();
        delete agentAuthorizations[tokenId];
        emit AgentRevoked(tokenId, msg.sender);
    }

    /// @notice Seller lists their passport directly.
    /// @param tokenId Passport token id.
    /// @param fiatPrice1e8 Listing price in listing currency (1e8 decimals).
    /// @param currencyCode ISO 4217 bytes32 or CURRENCY_NATIVE.
    function list(uint256 tokenId, uint128 fiatPrice1e8, bytes32 currencyCode) external nonReentrant {
        if (paused) revert ContractPaused();
        if (fiatPrice1e8 == 0) revert BadPrice();
        _requireCurrencySupported(currencyCode);
        if (listings[tokenId].active) revert AlreadyListed();
        if (karPassport.ownerOf(tokenId) != msg.sender) revert NotOwner();

        karPassport.safeTransferFrom(msg.sender, address(this), tokenId);
        _writeListing(tokenId, msg.sender, fiatPrice1e8, currencyCode, address(0), 0, 0, bytes(""));
    }

    /// @notice Agent lists on behalf of owner with agent fee.
    function listOnBehalf(
        uint256 tokenId,
        uint128 fiatPrice1e8,
        bytes32 currencyCode,
        uint16 agentFeeBps,
        bytes calldata settlementNote
    ) external nonReentrant {
        if (paused) revert ContractPaused();
        if (fiatPrice1e8 == 0) revert BadPrice();
        if (agentFeeBps > _MAX_AGENT_FEE_BPS) revert AgentFeeTooHigh();
        _requireCurrencySupported(currencyCode);

        AgentAuth memory auth = agentAuthorizations[tokenId];
        if (!auth.active || auth.agent != msg.sender) revert AgentNotAuthorized();
        if (auth.expiry != 0 && block.timestamp > auth.expiry) revert AgentNotAuthorized();
        if (listings[tokenId].active) revert AlreadyListed();

        address owner = karPassport.ownerOf(tokenId);
        _checkSellerNet(fiatPrice1e8, agentFeeBps, platformFeeBps, auth.ownerMinPrice1e8);

        karPassport.safeTransferFrom(owner, address(this), tokenId);
        _writeListing(
            tokenId, owner, fiatPrice1e8, currencyCode, msg.sender, agentFeeBps, auth.ownerMinPrice1e8, settlementNote
        );
    }

    /// @notice Agent updates price and own fee on an active agent listing.
    /// @dev Agent may update fees between buyer's off-chain quote and purchase.
    ///      The seller minimum (ownerMinPrice1e8) is always enforced.
    ///      Buyers should quote immediately before purchase for accurate split.
    function updateListing(uint256 tokenId, uint128 newPrice, uint16 newAgentFeeBps) external nonReentrant {
        if (paused) revert ContractPaused();
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.agent != msg.sender) revert NotAgent();
        if (newPrice == 0) revert BadPrice();
        if (newAgentFeeBps > _MAX_AGENT_FEE_BPS) revert AgentFeeTooHigh();
        _checkSellerNet(newPrice, newAgentFeeBps, platformFeeBps, l.ownerMinPrice1e8);

        l.fiatPrice1e8 = newPrice;
        l.agentFeeBps = newAgentFeeBps;
        emit ListingUpdated(tokenId, newPrice, newAgentFeeBps);
    }

    /// @notice Seller lowers (or keeps) minimum net price on an agent listing.
    function updateOwnerMinPrice(uint256 tokenId, uint128 newMin) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        if (l.agent == address(0)) revert NoAgent();
        if (newMin > l.ownerMinPrice1e8) revert CannotRaiseMinPrice();
        _checkSellerNet(l.fiatPrice1e8, l.agentFeeBps, platformFeeBps, newMin);
        l.ownerMinPrice1e8 = newMin;
        emit OwnerMinPriceUpdated(tokenId, newMin);
    }

    /// @notice Seller requests return of NFT from agent listing (starts 7-day cooldown).
    /// @dev Reverts if a return has already been requested.
    ///      Call agentDelist to cancel the listing before requesting again.
    function requestReturn(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        if (l.agent == address(0)) revert NoAgent();
        if (returnRequestedAt[tokenId] != 0) revert ReturnAlreadyRequested();
        returnRequestedAt[tokenId] = block.timestamp;
        emit ReturnRequested(tokenId, msg.sender);
    }

    /// @notice Agent voluntarily returns NFT to seller.
    function agentDelist(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.agent != msg.sender) revert NotAgent();
        _returnToSeller(tokenId);
        emit AgentDelisted(tokenId, msg.sender);
    }

    /// @notice Seller force-returns NFT after 7 days from requestReturn.
    function forceReturn(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        uint256 requestedAt = returnRequestedAt[tokenId];
        if (requestedAt == 0) revert ReturnNotRequested();
        if (block.timestamp < requestedAt + _RETURN_COOLDOWN) revert ReturnCooldownPending();
        _returnToSeller(tokenId);
        emit ForceReturn(tokenId, msg.sender);
    }

    /// @notice Seller delists a direct (non-agent) listing.
    function delist(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        if (l.agent != address(0)) revert ListingHasAgent();
        _returnToSeller(tokenId);
        emit Delisted(tokenId, msg.sender);
    }

    /// @notice Buy with native chain token at quoted amount.
    function buyWithNative(uint256 tokenId) external payable nonReentrant {
        if (paused) revert ContractPaused();
        uint256 gross = quoteBuyWithNative(tokenId);
        if (msg.value != gross) revert WrongValue();
        _settleNative(tokenId, msg.sender, gross);
    }

    /// @notice Buy with an approved ERC-20 token at quoted amount.
    /// @param tokenId Listing token id.
    /// @param tokenAddress ERC-20 address; address(0) triggers native purchase path.
    function buyWithToken(uint256 tokenId, address tokenAddress) external payable nonReentrant {
        if (paused) revert ContractPaused();
        if (tokenAddress == address(0)) {
            uint256 grossNative = quoteBuyWithNative(tokenId);
            if (msg.value != grossNative) revert WrongValue();
            _settleNative(tokenId, msg.sender, grossNative);
            return;
        }
        PaymentTokenConfig memory cfg = paymentTokens[tokenAddress];
        if (!cfg.enabled) revert PaymentTokenNotSupported();
        uint256 gross = quoteBuyWithToken(tokenId, tokenAddress);
        _settleErc20(tokenId, msg.sender, tokenAddress, gross);
    }

    /// @notice Seller sets an off-chain payment destination (Lightning, BTC, IBAN, cash).
    /// @dev Enables confirmExternalPayment for direct (non-agent) listings.
    ///      Trust model: seller attests payment received off-chain.
    ///      Platform does not verify. Not cryptographically proven.
    /// @param tokenId Active listing token id.
    /// @param note Encoded payment destination (e.g. "lightning:lnbc...", "btc:bc1q...").
    function setSettlementNote(uint256 tokenId, bytes calldata note) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        if (note.length == 0) revert EmptySettlementNote();
        settlementNotes[tokenId] = note;
        emit SettlementNoteSet(tokenId, msg.sender);
    }

    /// @notice Seller or agent confirms off-chain payment received; NFT transfers to buyer with zero platform fee.
    /// @dev Trust model: seller attests payment off-chain. Platform does not verify. Not cryptographically proven.
    /// @param tokenId Listing token id.
    /// @param buyer Buyer address to receive the NFT.
    function confirmExternalPayment(uint256 tokenId, address buyer) external nonReentrant {
        if (paused) revert ContractPaused();
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (msg.sender != l.seller && msg.sender != l.agent) revert NotSellerOrAgent();
        bytes memory note = settlementNotes[tokenId];
        if (note.length == 0) revert EmptySettlementNote();
        if (buyer == address(0)) revert ZeroAddress();

        l.active = false;
        delete settlementNotes[tokenId];
        delete returnRequestedAt[tokenId];

        karPassport.safeTransferFrom(address(this), buyer, tokenId);
        emit ExternalPaymentConfirmed(tokenId, buyer, msg.sender);
        _clearListingStorage(tokenId);
    }

    /// @notice USD-equivalent value of listing (1e8).
    function listingUsd1e8(uint256 tokenId) public view returns (uint256) {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        return _listingToUsd1e8(l.fiatPrice1e8, l.currencyCode);
    }

    /// @notice Native wei required to purchase listing.
    function quoteBuyWithNative(uint256 tokenId) public view returns (uint256) {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.currencyCode == CURRENCY_NATIVE) {
            return uint256(l.fiatPrice1e8) * 1e10;
        }
        uint256 usd1e8 = _listingToUsd1e8(l.fiatPrice1e8, l.currencyCode);
        (, int256 px,, uint256 upd,) = nativeUsdFeed.latestRoundData();
        _checkFeedFresh(upd);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * 1e18) / uint256(px);
    }

    /// @notice ERC-20 amount required to purchase listing (token native decimals).
    function quoteBuyWithToken(uint256 tokenId, address tokenAddress) public view returns (uint256) {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (tokenAddress == address(0)) {
            return quoteBuyWithNative(tokenId);
        }
        PaymentTokenConfig memory cfg = paymentTokens[tokenAddress];
        if (!cfg.enabled) revert PaymentTokenNotSupported();

        uint256 usd1e8 = _listingToUsd1e8(l.fiatPrice1e8, l.currencyCode);
        if (cfg.feed == address(0)) {
            return (usd1e8 * 1e6) / _FIAT_SCALE;
        }
        (, int256 px,, uint256 upd,) = AggregatorV3Interface(cfg.feed).latestRoundData();
        _checkFeedFresh(upd);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * 1e18) / uint256(px);
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

    function _validateFeed(address feed) internal view {
        if (feed.code.length == 0) revert InvalidFeed();
        AggregatorV3Interface agg = AggregatorV3Interface(feed);
        if (agg.decimals() != 8) revert InvalidFeedDecimals();
        (, int256 answer,,,) = agg.latestRoundData();
        if (answer <= 0) revert BadOracleAnswer();
    }

    function _requireCurrencySupported(bytes32 currencyCode) internal view {
        if (currencyCode == CURRENCY_USD) return;
        if (currencyCode == CURRENCY_NATIVE) return;
        address feed = currencyFeeds[currencyCode];
        if (feed == address(0)) revert CurrencyNotAvailableOnChain();
    }

    function _listingToUsd1e8(uint128 fiatPrice1e8, bytes32 currencyCode) internal view returns (uint256) {
        if (currencyCode == CURRENCY_USD || currencyCode == CURRENCY_NATIVE) {
            return uint256(fiatPrice1e8);
        }
        address feed = currencyFeeds[currencyCode];
        if (feed == address(0)) revert CurrencyNotAvailableOnChain();
        (, int256 rate,, uint256 upd,) = AggregatorV3Interface(feed).latestRoundData();
        _checkFeedFresh(upd);
        if (rate <= 0) revert BadOracleAnswer();
        return (uint256(fiatPrice1e8) * uint256(rate)) / _FIAT_SCALE;
    }

    function _platformFeeBps(Listing storage l) internal view returns (uint256) {
        if (l.agent != address(0)) return platformFeeBps;
        return _feeBpsForSeller(l.seller);
    }

    function _feeBpsForSeller(address seller) internal view returns (uint256) {
        if (karProStaking != address(0)) {
            try IKarProStaking(karProStaking).isActiveVerifier(seller) returns (bool active) {
                if (active) return proFeeBps;
            } catch {}
        }
        return platformFeeBps;
    }

    function _checkFeedFresh(uint256 updatedAt) internal view {
        if (maxFeedStaleness > 0 && block.timestamp - updatedAt > maxFeedStaleness) {
            revert StalePrice();
        }
    }

    function _checkSellerNet(uint128 price, uint16 agentFeeBps, uint256 platformBps, uint128 ownerMin)
        internal
        pure
    {
        uint256 agentFee = (uint256(price) * agentFeeBps) / 10_000;
        uint256 platformFee = (uint256(price) * platformBps) / 10_000;
        if (uint256(price) - agentFee - platformFee < ownerMin) revert BelowOwnerMinPrice();
    }

    function _writeListing(
        uint256 tokenId,
        address seller,
        uint128 fiatPrice1e8,
        bytes32 currencyCode,
        address agent,
        uint16 agentFeeBps,
        uint128 ownerMinPrice1e8,
        bytes memory settlementNote
    ) internal {
        listings[tokenId] = Listing({
            seller: seller,
            fiatPrice1e8: fiatPrice1e8,
            active: true,
            agent: agent,
            ownerMinPrice1e8: ownerMinPrice1e8,
            agentFeeBps: agentFeeBps,
            currencyCode: currencyCode
        });

        if (settlementNote.length > 0) {
            settlementNotes[tokenId] = settlementNote;
        }

        emit Listed(tokenId, seller, fiatPrice1e8, currencyCode, agent, agentFeeBps);
    }

    function _returnToSeller(uint256 tokenId) internal {
        Listing storage l = listings[tokenId];
        address seller = l.seller;
        l.active = false;
        karPassport.safeTransferFrom(address(this), seller, tokenId);
        _clearListingStorage(tokenId);
    }

    function _clearListingStorage(uint256 tokenId) internal {
        delete settlementNotes[tokenId];
        delete returnRequestedAt[tokenId];
        delete agentAuthorizations[tokenId];
        listings[tokenId].seller = address(0);
        listings[tokenId].fiatPrice1e8 = 0;
        listings[tokenId].agent = address(0);
        listings[tokenId].ownerMinPrice1e8 = 0;
        listings[tokenId].agentFeeBps = 0;
        listings[tokenId].currencyCode = bytes32(0);
    }

    function _minPaymentForOwnerMin(Listing storage l, address payToken) internal view returns (uint256) {
        if (l.ownerMinPrice1e8 == 0) return 0;
        if (payToken == address(0)) {
            if (l.currencyCode == CURRENCY_NATIVE) {
                return uint256(l.ownerMinPrice1e8) * 1e10;
            }
            uint256 usdMin = _listingToUsd1e8(l.ownerMinPrice1e8, l.currencyCode);
            (, int256 px,, uint256 upd,) = nativeUsdFeed.latestRoundData();
            _checkFeedFresh(upd);
            if (px <= 0) revert BadOracleAnswer();
            return (usdMin * 1e18) / uint256(px);
        }
        uint256 usdMinErc20 = _listingToUsd1e8(l.ownerMinPrice1e8, l.currencyCode);
        PaymentTokenConfig memory cfg = paymentTokens[payToken];
        if (cfg.feed == address(0)) {
            return (usdMinErc20 * 1e6) / _FIAT_SCALE;
        }
        (, int256 tokenPx,, uint256 tokenUpd,) = AggregatorV3Interface(cfg.feed).latestRoundData();
        _checkFeedFresh(tokenUpd);
        if (tokenPx <= 0) revert BadOracleAnswer();
        return (usdMinErc20 * 1e18) / uint256(tokenPx);
    }

    function _settleNative(uint256 tokenId, address buyer, uint256 gross) internal {
        Listing storage l = listings[tokenId];
        address seller = l.seller;
        address agent = l.agent;
        uint16 agentBps = l.agentFeeBps;

        uint256 platformBps = _platformFeeBps(l);
        uint256 agentFee = agent == address(0) ? 0 : (gross * agentBps) / 10_000;
        uint256 platformFee = (gross * platformBps) / 10_000;
        uint256 net = gross - agentFee - platformFee;

        if (agent != address(0)) {
            uint256 minNet = _minPaymentForOwnerMin(l, address(0));
            if (net < minNet) revert BelowOwnerMinPrice();
        }

        l.active = false;

        if (platformFee > 0) {
            _payNative(platformRecipient, platformFee);
        }
        if (agentFee > 0) {
            _payNative(agent, agentFee);
        }
        _payNative(seller, net);

        karPassport.safeTransferFrom(address(this), buyer, tokenId);
        emit Sale(tokenId, buyer, seller, gross, platformFee, agentFee, net, address(0), agent);
        _clearListingStorage(tokenId);
    }

    function _settleErc20(uint256 tokenId, address buyer, address tokenAddress, uint256 gross) internal {
        Listing storage l = listings[tokenId];
        address seller = l.seller;
        address agent = l.agent;
        uint16 agentBps = l.agentFeeBps;

        uint256 platformBps = _platformFeeBps(l);
        uint256 agentFee = agent == address(0) ? 0 : (gross * agentBps) / 10_000;
        uint256 platformFee = (gross * platformBps) / 10_000;
        uint256 net = gross - agentFee - platformFee;

        if (agent != address(0)) {
            uint256 minNet = _minPaymentForOwnerMin(l, tokenAddress);
            if (net < minNet) revert BelowOwnerMinPrice();
        }

        l.active = false;

        IERC20 token = IERC20(tokenAddress);
        token.safeTransferFrom(buyer, address(this), gross);
        if (platformFee > 0) _payErc20(tokenAddress, platformRecipient, platformFee);
        if (agentFee > 0) _payErc20(tokenAddress, agent, agentFee);
        _payErc20(tokenAddress, seller, net);

        karPassport.safeTransferFrom(address(this), buyer, tokenId);
        emit Sale(tokenId, buyer, seller, gross, platformFee, agentFee, net, tokenAddress, agent);
        _clearListingStorage(tokenId);
    }
}
