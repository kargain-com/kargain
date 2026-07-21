// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KarPassport} from "../KarPassport.sol";

/// @notice Test-only forwarder that calls KarPassport gateway-only entrypoints as `msg.sender`.
/// @dev Used to exercise `onlyGateway` without deploying KarPassportBridgeGateway.
contract MockBridgeGateway {
    KarPassport public immutable passport;

    constructor(KarPassport passport_) {
        passport = passport_;
    }

    function setCustodyLock(uint256 tokenId, bool locked) external {
        passport.setCustodyLock(tokenId, locked);
    }

    function bridgeMint(address to, uint256 tokenId, string calldata uri) external {
        passport.bridgeMint(to, tokenId, uri);
    }

    function bridgeBurn(uint256 tokenId) external {
        passport.bridgeBurn(tokenId);
    }

    function bridgeResetOnUnlock(uint256 tokenId, string calldata uri) external {
        passport.bridgeResetOnUnlock(tokenId, uri);
    }
}
