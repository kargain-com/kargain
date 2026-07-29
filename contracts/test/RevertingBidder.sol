// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAuctionEscrow} from "../interfaces/IAuctionEscrow.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IClaimWithdraw {
    function withdrawClaim(address asset) external;
}

/// @notice Contract bidder that reverts on native receive until `acceptEth` is set — tests claim credits.
contract RevertingBidder {
    IAuctionEscrow public immutable escrow;
    bool public acceptEth;

    constructor(IAuctionEscrow escrow_) {
        escrow = escrow_;
    }

    function setAcceptEth(bool value) external {
        acceptEth = value;
    }

    /// @notice Place a native bid through the escrow.
    function bidNative(uint256 tokenId) external payable {
        escrow.bid{value: msg.value}(tokenId, uint128(msg.value));
    }

    function withdrawClaim(address asset) external {
        escrow.withdrawClaim(asset);
    }

    receive() external payable {
        if (!acceptEth) revert("RevertingBidder: no receive");
    }
}

interface IKarProStakingJoinLeave {
    function becomeVerifierNative(uint8 category, string calldata name, string calldata metadataURI)
        external
        payable;

    function leave() external;

    function claimStake() external;
}

interface IFixedPriceConsignment {
    struct Denomination {
        uint8 kind;
        bytes32 currencyCode;
    }

    struct Compensation {
        uint8 form;
        uint16 commissionBps;
    }

    function openDirect(
        uint256 tokenId,
        Denomination calldata denomination,
        address asset,
        uint128 price
    ) external;

    function grant(
        uint256 tokenId,
        address agent,
        uint64 expiry,
        address asset,
        Denomination calldata denomination,
        uint128 floor,
        Compensation calldata compensation
    ) external;

    function openFromMandate(uint256 tokenId, Denomination calldata denomination, uint128 price)
        external;
}

/// @notice Recipient that reverts on native receive until `acceptEth` is set — tests claim credits.
contract RevertingRecipient {
    bool public acceptEth;

    function setAcceptEth(bool value) external {
        acceptEth = value;
    }

    receive() external payable {
        if (!acceptEth) revert("RevertingRecipient: no receive");
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0x150b7a02);
    }

    /// @notice Join as verifier; msg.sender for staking is this contract (needs onERC721Received).
    function joinNative(
        address staking,
        uint8 category,
        string calldata name,
        string calldata metadataURI
    ) external payable {
        IKarProStakingJoinLeave(staking).becomeVerifierNative{value: msg.value}(category, name, metadataURI);
    }

    /// @notice Leave staking; role ends; stake unlocks after unbonding via claimStake.
    function leaveStaking(address staking) external {
        IKarProStakingJoinLeave(staking).leave();
    }

    /// @notice Claim unlocked stake after unbonding; native refund hits receive() and may fail → claim.
    function claimStake(address staking) external {
        IKarProStakingJoinLeave(staking).claimStake();
    }

    function withdrawClaim(address staking, address asset) external {
        IClaimWithdraw(staking).withdrawClaim(asset);
    }

    function approvePassport(address passport, address operator, bool approved) external {
        IERC721(passport).setApprovalForAll(operator, approved);
    }

    function openFixedDirect(
        address mode,
        uint256 tokenId,
        uint8 denomKind,
        bytes32 currencyCode,
        address asset,
        uint128 price
    ) external {
        IFixedPriceConsignment(mode).openDirect(
            tokenId,
            IFixedPriceConsignment.Denomination(denomKind, currencyCode),
            asset,
            price
        );
    }

    function grantFixed(
        address mode,
        uint256 tokenId,
        address agent,
        uint64 expiry,
        address asset,
        uint8 denomKind,
        bytes32 currencyCode,
        uint128 floor,
        uint8 compensationForm,
        uint16 commissionBps
    ) external {
        IFixedPriceConsignment(mode).grant(
            tokenId,
            agent,
            expiry,
            asset,
            IFixedPriceConsignment.Denomination(denomKind, currencyCode),
            floor,
            IFixedPriceConsignment.Compensation(compensationForm, commissionBps)
        );
    }

    function openFixedFromMandate(
        address mode,
        uint256 tokenId,
        uint8 denomKind,
        bytes32 currencyCode,
        uint128 price
    ) external {
        IFixedPriceConsignment(mode).openFromMandate(
            tokenId,
            IFixedPriceConsignment.Denomination(denomKind, currencyCode),
            price
        );
    }

    /// @notice Owner-only helper: approve escrow and authorize agent (msg.sender to escrow = this contract).
    function authorizeAgentForSelf(
        address passport,
        address escrow,
        uint256 tokenId,
        address agent,
        address asset
    ) external {
        IERC721(passport).setApprovalForAll(escrow, true);
        IAuctionEscrow(escrow).authorizeAuctionAgent(tokenId, agent, 0, asset, 0);
    }
}

/// @notice Malicious bidder that attempts reentrancy during outbid refund.
contract ReentrantBidder {
    IAuctionEscrow public immutable escrow;
    uint256 public targetTokenId;
    uint128 public nextAmount;
    bool public reentering;

    constructor(IAuctionEscrow escrow_) {
        escrow = escrow_;
    }

    function configure(uint256 tokenId, uint128 amount) external {
        targetTokenId = tokenId;
        nextAmount = amount;
    }

    function bidNative(uint256 tokenId, uint128 amount) external payable {
        escrow.bid{value: msg.value}(tokenId, amount);
    }

    receive() external payable {
        if (reentering) return;
        if (nextAmount > 0) {
            reentering = true;
            escrow.bid{value: nextAmount}(targetTokenId, nextAmount);
            reentering = false;
        }
    }
}
