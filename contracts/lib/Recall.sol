// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Recall
 * @notice Owner structural remedy against an agent who will not sell (OFFERED, agented only).
 *
 * @dev Spec: docs/research/commerce-model-2026.md §6, §11, §13a.3; invariant RC1.
 *      Agent withdrawal is not part of this library — it is an ordinary OFFERED exit.
 *      Cooldown is a non-governed constant (carried 7 days from existing escrows).
 */
abstract contract Recall {
    /// @dev Carried from legacy commerce recall cooldown. Model §11 leaves the duration unnamed.
    uint256 internal constant RECALL_COOLDOWN = 7 days;

    mapping(uint256 tokenId => uint256) internal recallRequestedAt;

    error NotConsignmentSeller();
    error NotOfferedAgented();
    error ReturnAlreadyRequested();
    error ReturnNotRequested();
    error ReturnCooldownPending();

    event RecallRequested(uint256 indexed tokenId, address indexed seller, uint256 requestedAt);

    function recallRequestTimestamp(uint256 tokenId) public view returns (uint256) {
        return recallRequestedAt[tokenId];
    }

    function recallCooldown() public pure returns (uint256) {
        return RECALL_COOLDOWN;
    }

    /// @notice Owner starts the recall cooldown (OFFERED + agented).
    function requestRecall(uint256 tokenId) external {
        if (!isOfferedAgented(tokenId)) revert NotOfferedAgented();
        if (consignmentSeller(tokenId) != msg.sender) revert NotConsignmentSeller();
        if (recallRequestedAt[tokenId] != 0) revert ReturnAlreadyRequested();

        recallRequestedAt[tokenId] = block.timestamp;
        emit RecallRequested(tokenId, msg.sender, block.timestamp);
    }

    /// @notice Owner forces return after the cooldown. Terminates the consignment; passport to owner.
    function forceRecall(uint256 tokenId) external {
        if (!isOfferedAgented(tokenId)) revert NotOfferedAgented();
        if (consignmentSeller(tokenId) != msg.sender) revert NotConsignmentSeller();

        uint256 requestedAt = recallRequestedAt[tokenId];
        if (requestedAt == 0) revert ReturnNotRequested();
        if (block.timestamp < requestedAt + RECALL_COOLDOWN) revert ReturnCooldownPending();

        delete recallRequestedAt[tokenId];
        _onForceRecall(tokenId);
    }

    function _clearRecallRequest(uint256 tokenId) internal {
        delete recallRequestedAt[tokenId];
    }

    function isOfferedAgented(uint256 tokenId) internal view virtual returns (bool);

    function consignmentSeller(uint256 tokenId) internal view virtual returns (address);

    /// @dev Consumer terminates the consignment and returns the passport to the seller.
    function _onForceRecall(uint256 tokenId) internal virtual;

    /// @dev Future-safe layout under UUPS children. Used: recallRequestedAt mapping = 1; reserve to 50.
    uint256[49] private __gap;
}
