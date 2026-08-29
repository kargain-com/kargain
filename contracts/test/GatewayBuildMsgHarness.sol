// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    MessagingFee,
    SendParam
} from "@layerzerolabs/onft-evm/contracts/onft721/interfaces/IONFT721.sol";

import {KarPassportBridgeGateway} from "../KarPassportBridgeGateway.sol";

interface IERC721MetadataURI {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @notice Test-only: force an over-ceiling URI through the leave/quote funnel.
/// @dev Production passport writes refuse >ceiling, so a live N6 `tokenURI` cannot exceed it;
///      this harness still proves `_buildMsgAndOptionsWithUri` (quoteSend + pre-debit send).
contract GatewayBuildMsgHarness is KarPassportBridgeGateway {
    string private _forcedUri;
    bool private _useForcedUri;

    constructor(address karPassport, address lzEndpoint, address delegate)
        KarPassportBridgeGateway(karPassport, lzEndpoint, delegate)
    {}

    function setForcedUri(string calldata uri) external {
        _forcedUri = uri;
        _useForcedUri = true;
    }

    function clearForcedUri() external {
        _useForcedUri = false;
        _forcedUri = "";
    }

    function exposeBuildMsgAndOptionsWithUri(SendParam calldata sendParam, string memory uri)
        external
        view
        returns (bytes memory message, bytes memory options)
    {
        return _buildMsgAndOptionsWithUri(sendParam, uri);
    }

    function _buildMsgAndOptions(SendParam calldata sendParam)
        internal
        view
        override
        returns (bytes memory message, bytes memory options)
    {
        string memory uri = _useForcedUri
            ? _forcedUri
            : IERC721MetadataURI(address(innerToken)).tokenURI(sendParam.tokenId);
        return _buildMsgAndOptionsWithUri(sendParam, uri);
    }

    /// @notice Same pre-debit build-then-debit order as production `send`, with forced URI.
    function exposeSendBuildThenDebit(
        SendParam calldata sendParam,
        MessagingFee calldata /* fee */,
        address /* refundAddress */,
        string calldata uri
    ) external payable returns (bytes memory message, bytes memory options) {
        (message, options) = _buildMsgAndOptionsWithUri(sendParam, uri);
        _debit(msg.sender, sendParam.tokenId, sendParam.dstEid);
    }
}
