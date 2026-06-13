// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

interface IKarProStaking {
    function isActiveVerifier(address a) external view returns (bool);
}

/// @title MarketplaceEscrow
/// @notice KarPassport escrow; seller sets fiat (USD/EUR 1e8); buyer pays native or USDC using Chainlink quotes.
/// @dev UUPS upgradeable; timelock is the sole upgrade authority. ReentrancyGuard on external entrypoints.
contract MarketplaceEscrow is IERC721Receiver, ReentrancyGuard, Initializable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    IERC721 public immutable karPassport;
    IERC20 public immutable usdc;
    AggregatorV3Interface public immutable nativeUsdFeed;
    AggregatorV3Interface public immutable eurUsdFeed;

    uint16 public immutable platformFeeBps;
    uint256 public immutable proFeeBps;
    address public immutable platformRecipient;
    address public immutable karProStaking;
    uint256 public immutable maxFeedStaleness;

    /// @dev Set via proxy `initialize`; timelock holds upgrade authority (48h delay on scheduled upgrades).
    address public upgradeAuthority;

    enum FiatCurrency {
        USD,
        EUR
    }

    struct Listing {
        address seller;
        uint128 fiatPrice1e8;
        FiatCurrency fiat;
        bool active;
    }

    mapping(uint256 tokenId => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint128 fiatPrice1e8, uint8 fiatCurrency);
    event Delisted(uint256 indexed tokenId, address indexed seller);
    event Sale(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 gross,
        uint256 fee,
        uint256 netToSeller,
        uint8 payAsset
    );

    error NotSeller();
    error NotActive();
    error BadPrice();
    error FeeTooHigh();
    error TransferFailed();
    error StalePrice();
    error BadOracleAnswer();
    error EurNotSupported();
    error ZeroTimelock();

    uint256 internal constant _MAX_FEE_BPS = 1000;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address karPassport_,
        address usdc_,
        address nativeUsdFeed_,
        address eurUsdFeed_,
        address karProStaking_,
        address platformRecipient_,
        uint256 feeBps_,
        uint256 proFeeBps_,
        uint256 maxFeedStaleness_
    ) {
        _disableInitializers();
        require(karPassport_ != address(0), "Marketplace: zero nft");
        require(usdc_ != address(0), "Marketplace: zero usdc");
        require(nativeUsdFeed_ != address(0), "Marketplace: zero feed");
        require(platformRecipient_ != address(0), "Marketplace: zero platform");
        if (feeBps_ > _MAX_FEE_BPS || proFeeBps_ > _MAX_FEE_BPS) revert FeeTooHigh();

        karPassport = IERC721(karPassport_);
        usdc = IERC20(usdc_);
        nativeUsdFeed = AggregatorV3Interface(nativeUsdFeed_);
        eurUsdFeed = AggregatorV3Interface(eurUsdFeed_);
        karProStaking = karProStaking_;
        platformRecipient = platformRecipient_;
        platformFeeBps = uint16(feeBps_);
        proFeeBps = proFeeBps_;
        maxFeedStaleness = maxFeedStaleness_;
    }

    /// @notice Proxy initializer; stores timelock as upgrade authority.
    function initialize(address timelockAddress_) external initializer {
        if (timelockAddress_ == address(0)) revert ZeroTimelock();
        upgradeAuthority = timelockAddress_;
    }

    function _authorizeUpgrade(address) internal view override {
        require(msg.sender == upgradeAuthority, "Marketplace: not upgrade authority");
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
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

    /// @notice USD value of listing in 1e8 "dollar" units (for EUR, converts via EUR/USD feed).
    function listingUsd1e8(uint256 tokenId) public view returns (uint256) {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.fiat == FiatCurrency.USD) {
            return uint256(l.fiatPrice1e8);
        }
        if (address(eurUsdFeed) == address(0)) revert EurNotSupported();
        (, int256 eurUsd,, uint256 upd,) = eurUsdFeed.latestRoundData();
        _checkFeedFresh(upd);
        if (eurUsd <= 0) revert BadOracleAnswer();
        return (uint256(l.fiatPrice1e8) * uint256(eurUsd)) / 1e8;
    }

    /// @notice Native wei required to pay the listing (uses NATIVE/USD feed; answer = USD per 1 native, 8 decimals).
    function quoteNativeWei(uint256 tokenId) public view returns (uint256) {
        uint256 usd1e8 = listingUsd1e8(tokenId);
        (, int256 px,, uint256 upd,) = nativeUsdFeed.latestRoundData();
        _checkFeedFresh(upd);
        if (px <= 0) revert BadOracleAnswer();
        return (usd1e8 * 1e18) / uint256(px);
    }

    /// @notice USDC amount (6 decimals) — assumes USDC ≈ USD.
    function quoteUsdcAmount(uint256 tokenId) public view returns (uint256) {
        uint256 usd1e8 = listingUsd1e8(tokenId);
        return (usd1e8 * 1e6) / 1e8;
    }

    /// @notice Seller escrows NFT; `fiatPrice1e8` is whole+8 decimal fiat (e.g. $100 = 100_00000000).
    function list(uint256 tokenId, uint128 fiatPrice1e8, uint8 fiatCurrency) external nonReentrant {
        if (fiatPrice1e8 == 0) revert BadPrice();
        if (fiatCurrency > uint8(FiatCurrency.EUR)) revert BadPrice();
        FiatCurrency fc = FiatCurrency(fiatCurrency);
        if (fc == FiatCurrency.EUR && address(eurUsdFeed) == address(0)) revert EurNotSupported();

        Listing storage l = listings[tokenId];
        require(!l.active, "Marketplace: already listed");
        address seller = msg.sender;
        require(karPassport.ownerOf(tokenId) == seller, "Marketplace: not owner");

        karPassport.safeTransferFrom(seller, address(this), tokenId);
        l.seller = seller;
        l.fiatPrice1e8 = fiatPrice1e8;
        l.fiat = fc;
        l.active = true;
        emit Listed(tokenId, seller, fiatPrice1e8, fiatCurrency);
    }

    /// @notice Seller delists and recovers the escrowed NFT.
    function delist(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        address seller = l.seller;
        l.active = false;
        l.fiatPrice1e8 = 0;
        l.seller = address(0);
        karPassport.safeTransferFrom(address(this), seller, tokenId);
        emit Delisted(tokenId, seller);
    }

    /// @notice Buy listing with native token at the quoted wei amount.
    function buyWithNative(uint256 tokenId) external payable nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        uint256 gross = quoteNativeWei(tokenId);
        if (msg.value != gross) revert BadPrice();

        address seller = l.seller;
        l.active = false;
        l.fiatPrice1e8 = 0;
        l.seller = address(0);

        uint256 feeBps = _feeBpsForSeller(seller);
        uint256 fee = (gross * feeBps) / 10_000;
        uint256 net = gross - fee;

        (bool feeOk,) = payable(platformRecipient).call{value: fee}("");
        if (!feeOk) revert TransferFailed();
        (bool sellerOk,) = payable(seller).call{value: net}("");
        if (!sellerOk) revert TransferFailed();

        karPassport.safeTransferFrom(address(this), msg.sender, tokenId);
        emit Sale(tokenId, msg.sender, seller, gross, fee, net, 0);
    }

    /// @notice Buy listing with USDC at the quoted amount.
    function buyWithUsdc(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        uint256 gross = quoteUsdcAmount(tokenId);

        address seller = l.seller;
        l.active = false;
        l.fiatPrice1e8 = 0;
        l.seller = address(0);

        uint256 feeBps = _feeBpsForSeller(seller);
        uint256 fee = (gross * feeBps) / 10_000;
        uint256 net = gross - fee;

        usdc.safeTransferFrom(msg.sender, address(this), gross);
        usdc.safeTransfer(platformRecipient, fee);
        usdc.safeTransfer(seller, net);

        karPassport.safeTransferFrom(address(this), msg.sender, tokenId);
        emit Sale(tokenId, msg.sender, seller, gross, fee, net, 1);
    }

    receive() external payable {}
}
