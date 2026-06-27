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

import {ONFT721Adapter} from "@layerzerolabs/onft-evm/contracts/onft721/ONFT721Adapter.sol";
import {SendParam} from "@layerzerolabs/onft-evm/contracts/onft721/interfaces/IONFT721.sol";
import {ONFT721MsgCodec} from "@layerzerolabs/onft-evm/contracts/onft721/libs/ONFT721MsgCodec.sol";
import {IOAppMsgInspector} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppMsgInspector.sol";

import {IMarketplaceEscrow} from "./interfaces/IMarketplaceEscrow.sol";

interface IERC721MetadataURI {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @title ProxyONFT721Adapter
/// @notice LayerZero adapter for an existing KarPassport ERC-721 on the hub chain (lock-and-bridge).
/// @dev Embeds tokenURI in the ONFT message extension; blocks bridge while listed on MarketplaceEscrow.
/// @custom:version 1.0.0-rc.1
contract ProxyONFT721Adapter is ONFT721Adapter {
    string public constant VERSION = "1.0.0-rc.1";

    using ONFT721MsgCodec for bytes;
    using ONFT721MsgCodec for bytes32;

    IMarketplaceEscrow public immutable marketplace;

    error ListedInMarketplace();

    /// @notice Deploys the adapter wrapping an existing ERC-721 KarPassport.
    /// @param token Underlying KarPassport address.
    /// @param marketplace_ MarketplaceEscrow for `isListed` guard.
    /// @param lzEndpoint LayerZero EndpointV2 address.
    /// @param delegate OApp delegate (typically owner).
    constructor(address token, address marketplace_, address lzEndpoint, address delegate)
        ONFT721Adapter(token, lzEndpoint, delegate)
    {
        marketplace = IMarketplaceEscrow(marketplace_);
    }

    /// @inheritdoc ONFT721Adapter
    function _debit(address from, uint256 tokenId, uint32 dstEid) internal virtual override {
        if (marketplace.isListed(tokenId)) revert ListedInMarketplace();
        super._debit(from, tokenId, dstEid);
    }

    /// @dev Embeds tokenURI in the ONFT message extension payload.
    function _buildMsgAndOptions(SendParam calldata sendParam)
        internal
        view
        override
        returns (bytes memory message, bytes memory options)
    {
        if (sendParam.to == bytes32(0)) revert InvalidReceiver();

        string memory uri = IERC721MetadataURI(address(innerToken)).tokenURI(sendParam.tokenId);
        bytes memory composeMsg = abi.encode(uri);
        bool hasCompose;
        (message, hasCompose) = ONFT721MsgCodec.encode(sendParam.to, sendParam.tokenId, composeMsg);
        uint16 msgType = hasCompose ? SEND_AND_COMPOSE : SEND;
        options = combineOptions(sendParam.dstEid, msgType, sendParam.extraOptions);

        address inspector = msgInspector;
        if (inspector != address(0)) IOAppMsgInspector(inspector).inspect(message, options);
    }
}
