// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ClaimablePayouts
/// @notice Single payout primitive: attempt transfer; on failure credit a claim the recipient withdraws.
/// @dev Children own ReentrancyGuard and wrap `withdrawClaim` with `nonReentrant`. Asset `address(0)` = native ETH.
///      Native push always uses `NATIVE_PUSH_GAS` so a griefing recipient cannot OOG the caller out of the claim path.
///      Withdraw deliberately forwards all gas — the caller is the recipient; a revert is the correct answer.
abstract contract ClaimablePayouts {
    /// @dev Gas forwarded on every native *push* attempt. Err small: surplus credit is withdrawable; insufficient
    ///      bound is a griefing surface. Recipients that need more gas (e.g. heavy smart accounts) get a claim.
    uint256 internal constant NATIVE_PUSH_GAS = 30_000;

    /// @dev account => asset (0 = ETH) => credited amount awaiting withdraw.
    mapping(address account => mapping(address asset => uint256)) private _pendingClaims;
    uint256 private _totalPendingNative;
    mapping(address asset => uint256) private _totalPendingErc20;

    /// @dev Reserve for future ClaimablePayouts state. Used slots = 3; total reserved = 50.
    ///      Extending this base shrinks `__gap` only — inheritor layouts do not move.
    uint256[47] private __gap;

    event ClaimRecorded(address indexed account, address indexed asset, uint256 amount);
    event ClaimWithdrawn(address indexed account, address indexed asset, uint256 amount);

    error NoClaim();
    error TransferFailed();

    /// @notice Outstanding claim for `account` in `asset` (`address(0)` = ETH).
    function pendingClaims(address account, address asset) public view returns (uint256) {
        return _pendingClaims[account][asset];
    }

    /// @notice Sum of all outstanding native claims (must be reserved from free balance).
    function totalPendingNative() public view returns (uint256) {
        return _totalPendingNative;
    }

    /// @notice Sum of outstanding claims for an ERC-20 `asset`.
    function totalPendingErc20(address asset) public view returns (uint256) {
        return _totalPendingErc20[asset];
    }

    /// @dev Attempt native payout with fixed `NATIVE_PUSH_GAS`. On failure (incl. subcall OOG), credit a claim.
    function _payNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{gas: NATIVE_PUSH_GAS, value: amount}("");
        if (ok) return;
        _creditClaim(to, address(0), amount);
    }

    /// @dev Attempt ERC-20 payout via low-level `transfer` (bool or empty return). On failure, credit claim.
    ///      Token conformance is enforced at admission — this path never reverts on returndata shape.
    function _payErc20(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (_tryErc20Transfer(token, to, amount)) return;
        _creditClaim(to, token, amount);
    }

    /// @dev CEI withdraw of `msg.sender`'s claim for `asset`. Reverts `TransferFailed` if recipient still cannot accept.
    ///      Native withdraw is intentionally unbounded (do not cap): the caller is the recipient; revert is correct.
    function _withdrawClaim(address asset) internal {
        uint256 amount = _pendingClaims[msg.sender][asset];
        if (amount == 0) revert NoClaim();

        _pendingClaims[msg.sender][asset] = 0;
        if (asset == address(0)) {
            _totalPendingNative -= amount;
        } else {
            _totalPendingErc20[asset] -= amount;
        }

        if (asset == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!_tryErc20Transfer(asset, msg.sender, amount)) revert TransferFailed();
        }

        emit ClaimWithdrawn(msg.sender, asset, amount);
    }

    function _creditClaim(address account, address asset, uint256 amount) private {
        _pendingClaims[account][asset] += amount;
        if (asset == address(0)) {
            _totalPendingNative += amount;
        } else {
            _totalPendingErc20[asset] += amount;
        }
        emit ClaimRecorded(account, asset, amount);
    }

    /// @dev Length-safe ERC-20 `transfer` result: success + (empty or 32-byte true). Never reverts on shape.
    function _tryErc20Transfer(address token, address to, uint256 amount) private returns (bool) {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount));
        if (!success) return false;
        if (data.length == 0) return true;
        if (data.length != 32) return false;
        return abi.decode(data, (bool));
    }
}
