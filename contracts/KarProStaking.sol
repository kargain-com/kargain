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
//   Upgradeable contracts (FixedPriceConsignment, AscendingConsignment):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope
//   Amend-in-place: ship VERSION stays until it exists on a commercial chain

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ClaimablePayouts} from "./lib/ClaimablePayouts.sol";

interface IKarProPass {
    function mint(address to, uint8 category, string calldata name, string calldata metadataURI) external;
    function burn(address holder) external;
}

/// @title KarProStaking
/// @notice Single entry point to become a verifier: stake native ETH, receive a KarProPass.
/// @dev Two-phase leave: role ends immediately; stake unlocks after UNBONDING_PERIOD via claimStake (ClaimablePayouts
///      on failed push). Re-entry blocked while unbonding. No dispute coupling — future slashing should use a
///      monotonic not-before unlock, never a decrementing counter. Storage layout: fresh deploy with KarProPass pair.
/// @custom:version 2.2.0-rc.1
contract KarProStaking is ClaimablePayouts, ReentrancyGuard, Ownable {
    string public constant VERSION = "2.2.0-rc.1";

    /// @notice Delay between leave (role ends) and claimStake (funds unlock).
    /// @dev Duration equals passport `DISPUTE_WINDOW` by convention only. Role ends immediately on
    ///      `leave` (`active = false`); `claimStake` checks elapsed time alone — there is no
    ///      challenge-gated unlock and no dispute coupling until a future slashing design.
    uint256 public constant UNBONDING_PERIOD = 14 days;

    struct Stake {
        address asset;
        uint256 amount;
        uint256 stakedAt;
        bool active;
        uint256 unlockAt;
    }

    IKarProPass public immutable proPass;

    uint256 public constant MIN_STAKE_FLOOR = 0.001 ether;

    uint256 public minStakeNative;

    mapping(address => Stake) public stakes;
    mapping(address => uint256) public verificationFee;

    error BelowMinStake();
    error AlreadyVerifier();
    error UnbondPending();
    error NotVerifier();
    error UnbondNotReady();
    error NoUnbond();
    error BelowMinStakeFloor();
    error ZeroAddress();

    event VerifierJoined(address indexed verifier, address asset, uint256 amount);
    event VerifierLeft(address indexed verifier, uint256 amount, uint256 unlockAt);
    event UnbondStarted(address indexed verifier, uint256 amount, uint256 unlockAt);
    event StakeClaimed(address indexed verifier, address asset, uint256 amount);
    event MinStakeNativeUpdated(uint256 newMin);
    event VerificationFeeUpdated(address indexed verifier, uint256 fee);

    /// @notice Deploys staking with the KarProPass contract and default 0.05 ETH minimum.
    /// @param proPass_ KarProPass contract address.
    /// @param initialOwner Owner for parameter updates.
    constructor(address proPass_, address initialOwner) Ownable(initialOwner) {
        if (proPass_ == address(0)) revert ZeroAddress();
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
        _requireCanJoin(msg.sender);

        stakes[msg.sender] = Stake({
            asset: address(0),
            amount: msg.value,
            stakedAt: block.timestamp,
            active: true,
            unlockAt: 0
        });

        proPass.mint(msg.sender, category, name, metadataURI);

        emit VerifierJoined(msg.sender, address(0), msg.value);
    }

    /// @notice End verifier role immediately; stake unlocks after UNBONDING_PERIOD via claimStake.
    /// @dev burn is wrapped in try/catch so unbonding always starts even if KarProPass burn authorization changed.
    ///      Clears `verificationFee` so a departed verifier cannot keep a directory fee slot (S34).
    function leave() external nonReentrant {
        Stake storage s = stakes[msg.sender];
        if (!s.active) revert NotVerifier();

        uint256 amount = s.amount;
        uint256 unlockAt = block.timestamp + UNBONDING_PERIOD;
        s.active = false;
        s.unlockAt = unlockAt;
        delete verificationFee[msg.sender];

        try proPass.burn(msg.sender) {} catch {}

        emit VerifierLeft(msg.sender, amount, unlockAt);
        emit UnbondStarted(msg.sender, amount, unlockAt);
    }

    /// @notice Claim native stake after the unbonding period. Failed push credits ClaimablePayouts.
    function claimStake() external nonReentrant {
        Stake storage s = stakes[msg.sender];
        if (s.active || s.unlockAt == 0) revert NoUnbond();
        if (block.timestamp < s.unlockAt) revert UnbondNotReady();

        uint256 amount = s.amount;
        s.amount = 0;
        s.unlockAt = 0;
        s.asset = address(0);
        s.stakedAt = 0;

        _payNative(msg.sender, amount);

        emit StakeClaimed(msg.sender, address(0), amount);
    }

    /// @notice Withdraw a pending native stake claim after a failed claimStake payout.
    function withdrawClaim(address asset) external nonReentrant {
        _withdrawClaim(asset);
    }

    /// @notice Updates the minimum native stake for new verifiers only.
    /// @dev Existing stakes keep their locked amount until leave + claim.
    ///      Minimum is capped at MIN_STAKE_FLOOR to prevent accidental zero-stake sybil attack.
    /// @param v New minimum native stake in wei.
    function setMinStakeNative(uint256 v) external onlyOwner {
        if (v < MIN_STAKE_FLOOR) revert BelowMinStakeFloor();
        minStakeNative = v;
        emit MinStakeNativeUpdated(v);
    }

    /// @notice Returns whether an address is an active verifier with a locked stake.
    /// @param a Address to query.
    /// @return True if the address has an active stake (false immediately after leave, including during unbond).
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

    function _requireCanJoin(address account) internal view {
        Stake storage s = stakes[account];
        if (s.active) revert AlreadyVerifier();
        if (s.unlockAt != 0 || s.amount > 0) revert UnbondPending();
    }
}
