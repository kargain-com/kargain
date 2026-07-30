// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {AscendingTypes} from "./AscendingTypes.sol";

/**
 * @title AscendingHoldLib
 * @notice Post-auction money hold: settle into hold, release/reversal paths, challenge freeze/thaw.
 * @dev Linked into AscendingConsignment via DELEGATECALL — mutates the mode's own storage.
 */
library AscendingHoldLib {
    error NotBinding();
    error AuctionNotEnded();
    error SettlementPending();
    error NoHold();
    error HoldNotReady();
    error NotHoldBuyer();
    error ReversalPending();
    error NoReversalPending();
    error AbandonmentNotReady();
    error ProtectionElapsed();
    error DisputeActive();
    error NotPassportHolder();

    event Settled(uint256 indexed tokenId, address indexed buyer, uint128 gross, uint64 protectionEndsAt);
    event ReversalStarted(uint256 indexed tokenId, address indexed buyer, uint64 abandonmentDeadline);

    function settle(
        mapping(uint256 => AscendingTypes.AuctionTerms) storage auctions,
        mapping(uint256 => AscendingTypes.Hold) storage holds,
        IERC721 passport,
        uint256 tokenId,
        bool binding
    ) external {
        if (!binding) revert NotBinding();
        AscendingTypes.AuctionTerms storage a = auctions[tokenId];
        if (a.endsAt == 0) revert NotBinding();
        if (block.timestamp < a.endsAt) revert AuctionNotEnded();
        if (holds[tokenId].buyer != address(0)) revert SettlementPending();

        address buyer = a.highestBidder;
        uint128 gross = a.highestBid;
        uint64 ends = uint64(block.timestamp + a.protectionWindow);
        uint40 abandonWin = a.abandonmentWindow;

        delete auctions[tokenId];
        passport.transferFrom(address(this), buyer, tokenId);

        holds[tokenId] = AscendingTypes.Hold({
            buyer: buyer,
            gross: gross,
            protectionEndsAt: ends,
            frozenRemaining: 0,
            reversalPending: false,
            abandonmentDeadline: 0,
            abandonmentWindow: abandonWin
        });

        emit Settled(tokenId, buyer, gross, ends);
    }

    function clearHoldForConfirm(
        mapping(uint256 => AscendingTypes.Hold) storage holds,
        uint256 tokenId,
        address sender,
        bool challengeActive
    ) external returns (address buyer, uint128 gross) {
        AscendingTypes.Hold storage h = _requireActiveHold(holds, tokenId);
        if (sender != h.buyer) revert NotHoldBuyer();
        if (challengeActive) revert DisputeActive();
        if (h.reversalPending) revert ReversalPending();
        buyer = h.buyer;
        gross = h.gross;
        delete holds[tokenId];
    }

    function clearHoldForRelease(
        mapping(uint256 => AscendingTypes.Hold) storage holds,
        uint256 tokenId,
        bool challengeActive
    ) external returns (address buyer, uint128 gross) {
        AscendingTypes.Hold storage h = _requireActiveHold(holds, tokenId);
        if (challengeActive) revert DisputeActive();
        if (h.reversalPending) revert ReversalPending();
        if (block.timestamp < h.protectionEndsAt) revert HoldNotReady();
        buyer = h.buyer;
        gross = h.gross;
        delete holds[tokenId];
    }

    function clearHoldForAbandon(mapping(uint256 => AscendingTypes.Hold) storage holds, uint256 tokenId)
        external
        returns (address buyer, uint128 gross)
    {
        AscendingTypes.Hold storage h = _requireActiveHold(holds, tokenId);
        if (!h.reversalPending) revert NoReversalPending();
        if (block.timestamp < h.abandonmentDeadline) revert AbandonmentNotReady();
        buyer = h.buyer;
        gross = h.gross;
        delete holds[tokenId];
    }

    function clearHoldForChallengeTerminal(mapping(uint256 => AscendingTypes.Hold) storage holds, uint256 tokenId)
        external
        returns (uint128 gross)
    {
        AscendingTypes.Hold storage h = _requireActiveHold(holds, tokenId);
        gross = h.gross;
        delete holds[tokenId];
    }

    function prepareCompleteReversal(
        mapping(uint256 => AscendingTypes.Hold) storage holds,
        IERC721 passport,
        uint256 tokenId,
        address sender
    ) external returns (address buyer, uint128 gross) {
        AscendingTypes.Hold storage h = _requireActiveHold(holds, tokenId);
        if (!h.reversalPending) revert NoReversalPending();
        if (sender != h.buyer) revert NotHoldBuyer();
        if (passport.ownerOf(tokenId) != h.buyer) revert NotPassportHolder();

        buyer = h.buyer;
        gross = h.gross;
        delete holds[tokenId];
        passport.transferFrom(buyer, address(this), tokenId);
    }

    function freezeForChallenge(mapping(uint256 => AscendingTypes.Hold) storage holds, uint256 tokenId) external {
        AscendingTypes.Hold storage h = _requireActiveHold(holds, tokenId);
        if (h.reversalPending) revert ReversalPending();
        if (h.frozenRemaining != 0) revert DisputeActive();
        if (block.timestamp >= h.protectionEndsAt) revert ProtectionElapsed();
        h.frozenRemaining = uint64(h.protectionEndsAt - block.timestamp);
    }

    function onUpheld(mapping(uint256 => AscendingTypes.Hold) storage holds, uint256 subjectId) external {
        AscendingTypes.Hold storage h = holds[subjectId];
        h.reversalPending = true;
        h.frozenRemaining = 0;
        h.protectionEndsAt = 0;
        h.abandonmentDeadline = uint64(block.timestamp + h.abandonmentWindow);
        emit ReversalStarted(subjectId, h.buyer, h.abandonmentDeadline);
    }

    function onWithdrawn(mapping(uint256 => AscendingTypes.Hold) storage holds, uint256 subjectId) external {
        AscendingTypes.Hold storage h = holds[subjectId];
        uint64 remaining = h.frozenRemaining;
        h.frozenRemaining = 0;
        h.protectionEndsAt = uint64(block.timestamp + remaining);
    }

    function _requireActiveHold(mapping(uint256 => AscendingTypes.Hold) storage holds, uint256 tokenId)
        private
        view
        returns (AscendingTypes.Hold storage h)
    {
        h = holds[tokenId];
        if (h.buyer == address(0)) revert NoHold();
    }
}
