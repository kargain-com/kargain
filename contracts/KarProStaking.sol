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

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ClaimablePayouts} from "./lib/ClaimablePayouts.sol";
import {Erc20Admission} from "./lib/Erc20Admission.sol";

interface IKarProPass {
    function mint(address to, uint8 category, string calldata name, string calldata metadataURI) external;
    function burn(address holder) external;
}

/// @title KarProStaking
/// @notice Single entry point to become a verifier: stake ETH or an optional ERC-20, receive a KarProPass.
/// @dev Stakes are fully refundable on leave; failed refunds become withdrawable claims. Owner cannot withdraw user funds.
/// @custom:version 1.3.0-rc.1
contract KarProStaking is ClaimablePayouts, ReentrancyGuard, Ownable {
    string public constant VERSION = "1.3.0-rc.1";

    using SafeERC20 for IERC20;

    enum StakeAsset {
        NATIVE,
        TOKEN
    }

    struct Stake {
        StakeAsset asset;
        uint256 amount;
        uint256 stakedAt;
        bool active;
    }

    IKarProPass public immutable proPass;

    uint256 public constant MIN_STAKE_FLOOR = 0.001 ether;

    uint256 public minStakeNative;
    address public stakeToken;
    uint256 public minStakeToken;

    mapping(address => Stake) public stakes;
    mapping(address => uint256) public verificationFee;

    error BelowMinStake();
    error AlreadyVerifier();
    error NotVerifier();
    error TokenNotEnabled();
    error BelowMinStakeFloor();

    event VerifierJoined(address indexed verifier, uint8 asset, uint256 amount);
    event VerifierLeft(address indexed verifier, uint256 returned);
    event MinStakeNativeUpdated(uint256 newMin);
    event StakeTokenSet(address token, uint256 minAmount);
    event VerificationFeeUpdated(address indexed verifier, uint256 fee);

    /// @notice Deploys staking with the KarProPass contract and default 0.05 ETH minimum.
    /// @param proPass_ KarProPass contract address.
    /// @param initialOwner Owner for parameter updates.
    constructor(address proPass_, address initialOwner) Ownable(initialOwner) {
        proPass = IKarProPass(proPass_);
        minStakeNative = 0.05 ether;
    }

    /// @notice Stake native ETH to become a verifier and mint a KarProPass.
    /// @param category Verifier category enum value passed to KarProPass.
    /// @param name Public verifier display name.
    /// @param metadataURI Off-chain profile metadata URI.
    function becomeVerifierNative(uint8 category, string calldata name, string calldata metadataURI)
        external
        payable
        nonReentrant
    {
        if (msg.value < minStakeNative) revert BelowMinStake();
        if (stakes[msg.sender].active) revert AlreadyVerifier();

        stakes[msg.sender] = Stake({
            asset: StakeAsset.NATIVE,
            amount: msg.value,
            stakedAt: block.timestamp,
            active: true
        });

        proPass.mint(msg.sender, category, name, metadataURI);

        emit VerifierJoined(msg.sender, 0, msg.value);
    }

    /// @notice Stake the configured ERC-20 token to become a verifier and mint a KarProPass.
    /// @param category Verifier category enum value passed to KarProPass.
    /// @param name Public verifier display name.
    /// @param metadataURI Off-chain profile metadata URI.
    function becomeVerifierToken(uint8 category, string calldata name, string calldata metadataURI)
        external
        nonReentrant
    {
        if (stakeToken == address(0)) revert TokenNotEnabled();
        if (stakes[msg.sender].active) revert AlreadyVerifier();

        IERC20 token = IERC20(stakeToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), minStakeToken);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received < minStakeToken) revert BelowMinStake();

        stakes[msg.sender] = Stake({
            asset: StakeAsset.TOKEN,
            amount: received,
            stakedAt: block.timestamp,
            active: true
        });

        proPass.mint(msg.sender, category, name, metadataURI);

        emit VerifierJoined(msg.sender, 1, received);
    }

    /// @notice Leave verifier status: burn KarProPass and return the locked stake amount.
    /// @dev burn is wrapped in try/catch so the stake is always refundable even if KarProPass burn authorization changed.
    function leave() external nonReentrant {
        Stake memory s = stakes[msg.sender];
        if (!s.active) revert NotVerifier();

        stakes[msg.sender].active = false;
        stakes[msg.sender].amount = 0;

        try proPass.burn(msg.sender) {} catch {}

        if (s.asset == StakeAsset.NATIVE) {
            _payNative(msg.sender, s.amount);
        } else {
            _payErc20(stakeToken, msg.sender, s.amount);
        }

        emit VerifierLeft(msg.sender, s.amount);
    }

    /// @notice Withdraw a pending native (`asset == address(0)`) or ERC-20 stake claim after a failed leave payout.
    function withdrawClaim(address asset) external nonReentrant {
        _withdrawClaim(asset);
    }

    /// @notice Updates the minimum native stake for new verifiers only.
    /// @dev Existing stakes keep their locked amount until leave.
    ///      Minimum is capped at MIN_STAKE_FLOOR to prevent accidental zero-stake sybil attack.
    /// @param v New minimum native stake in wei.
    function setMinStakeNative(uint256 v) external onlyOwner {
        if (v < MIN_STAKE_FLOOR) revert BelowMinStakeFloor();
        minStakeNative = v;
        emit MinStakeNativeUpdated(v);
    }

    /// @notice Enables or updates optional ERC-20 staking.
    /// @param token Conforming ERC-20 token address (zero is rejected).
    /// @param minAmount Minimum token amount required to join.
    function setStakeToken(address token, uint256 minAmount) external onlyOwner {
        Erc20Admission.requireConforming(token);
        stakeToken = token;
        minStakeToken = minAmount;
        emit StakeTokenSet(token, minAmount);
    }

    /// @notice Returns whether an address is an active verifier with a locked stake.
    /// @param a Address to query.
    /// @return True if the address has an active stake and KarProPass.
    function isActiveVerifier(address a) external view returns (bool) {
        return stakes[a].active;
    }

    /// @notice Active verifier sets their public verification service fee (informational; in wei).
    /// @param fee Fee amount in wei.
    function setVerificationFee(uint256 fee) external {
        if (!stakes[msg.sender].active) revert NotVerifier();
        verificationFee[msg.sender] = fee;
        emit VerificationFeeUpdated(msg.sender, fee);
    }
}
