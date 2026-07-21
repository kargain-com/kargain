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

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {ONFT721Adapter} from "@layerzerolabs/onft-evm/contracts/onft721/ONFT721Adapter.sol";
import {
    MessagingFee,
    MessagingReceipt,
    SendParam
} from "@layerzerolabs/onft-evm/contracts/onft721/interfaces/IONFT721.sol";
import {ONFT721MsgCodec} from "@layerzerolabs/onft-evm/contracts/onft721/libs/ONFT721MsgCodec.sol";
import {IOAppMsgInspector} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppMsgInspector.sol";
import {Origin} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";

import {IAuctionHold} from "./interfaces/IAuctionHold.sol";
import {IKarPassportBridge} from "./interfaces/IKarPassportBridge.sol";
import {IKarPassportStatus} from "./interfaces/IKarPassportStatus.sol";
import {IMarketplaceEscrow} from "./interfaces/IMarketplaceEscrow.sol";

interface IERC721MetadataURI {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @title KarPassportBridgeGateway
/// @notice Symmetric lock-and-mint / burn-and-unlock OApp for KarPassport v1.3 (SPEC §I.12).
/// @dev LayerZero imports are confined to this gateway (§7.6 provider isolation).
/// @custom:version 1.0.0-rc.1
contract KarPassportBridgeGateway is ONFT721Adapter {
    string public constant VERSION = "1.0.0-rc.1";

    using ONFT721MsgCodec for bytes;
    using ONFT721MsgCodec for bytes32;

    uint8 private constant _SENDER_BYTES = 32;

    IMarketplaceEscrow public immutable marketplace;
    /// @notice AuctionEscrow for settlement-hold guard; `address(0)` skips the hold check (e.g. spoke pre-C5).
    address public immutable auctionEscrow;

    error ListedInMarketplace();
    error PassportDisputed();
    error InSettlementHold();
    error NotRepresentationOwner();
    error ComposeMsgTooShort();

    /// @notice Deploys the symmetric bridge gateway wrapping a KarPassport.
    /// @param karPassport Underlying KarPassport address.
    /// @param marketplace_ MarketplaceEscrow for `isListed` outbound guard.
    /// @param auctionEscrow_ AuctionEscrow for settlement-hold guard (or zero).
    /// @param lzEndpoint LayerZero EndpointV2 address.
    /// @param delegate OApp delegate (typically owner).
    constructor(
        address karPassport,
        address marketplace_,
        address auctionEscrow_,
        address lzEndpoint,
        address delegate
    ) ONFT721Adapter(karPassport, lzEndpoint, delegate) {
        marketplace = IMarketplaceEscrow(marketplace_);
        auctionEscrow = auctionEscrow_;
    }

    function _isHome(uint256 tokenId) internal view returns (bool) {
        return (tokenId >> 128) == block.chainid;
    }

    /// @notice Send caches URI before debit so foreign `bridgeBurn` does not clear metadata mid-send.
    function send(
        SendParam calldata sendParam,
        MessagingFee calldata fee,
        address refundAddress
    ) external payable virtual override returns (MessagingReceipt memory msgReceipt) {
        string memory uri = IERC721MetadataURI(address(innerToken)).tokenURI(sendParam.tokenId);
        _debit(msg.sender, sendParam.tokenId, sendParam.dstEid);

        (bytes memory message, bytes memory options) = _buildMsgAndOptionsWithUri(sendParam, uri);
        msgReceipt = _lzSend(sendParam.dstEid, message, options, fee, refundAddress);
        emit ONFTSent(msgReceipt.guid, sendParam.dstEid, msg.sender, sendParam.tokenId);
    }

    /// @inheritdoc ONFT721Adapter
    function _debit(address from, uint256 tokenId, uint32 dstEid) internal virtual override {
        if (marketplace.isListed(tokenId)) revert ListedInMarketplace();
        if (
            IKarPassportStatus(address(innerToken)).passportStatus(tokenId)
                == IKarPassportStatus.Status.DISPUTED
        ) {
            revert PassportDisputed();
        }
        if (auctionEscrow != address(0)) {
            (,, uint40 releaseAt,,,) = IAuctionHold(auctionEscrow).holds(tokenId);
            if (releaseAt != 0) revert InSettlementHold();
        }

        if (_isHome(tokenId)) {
            super._debit(from, tokenId, dstEid);
            IKarPassportBridge(address(innerToken)).setCustodyLock(tokenId, true);
        } else {
            if (IERC721(address(innerToken)).ownerOf(tokenId) != from) {
                revert NotRepresentationOwner();
            }
            IKarPassportBridge(address(innerToken)).bridgeBurn(tokenId);
        }
    }

    /// @notice Receive: mint foreign representation or unlock home token with URI sync.
    function _lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address executor,
        bytes calldata extraData
    ) internal virtual override {
        address toAddress = message.sendTo().bytes32ToAddress();
        uint256 tokenId = message.tokenId();

        string memory uri;
        if (message.isComposed()) {
            bytes memory extension = message.composeMsg();
            if (extension.length > _SENDER_BYTES) {
                uri = abi.decode(_memoryTail(extension, _SENDER_BYTES), (string));
            }
        }

        if (!_isHome(tokenId)) {
            IKarPassportBridge(address(innerToken)).bridgeMint(toAddress, tokenId, uri);
        } else {
            IKarPassportBridge(address(innerToken)).bridgeResetOnUnlock(tokenId, uri);
            IERC721(address(innerToken)).transferFrom(address(this), toAddress, tokenId);
        }

        emit ONFTReceived(guid, origin.srcEid, toAddress, tokenId);
        executor;
        extraData;
    }

    /// @dev quoteSend still reads live tokenURI (token must exist at quote time).
    function _buildMsgAndOptions(SendParam calldata sendParam)
        internal
        view
        override
        returns (bytes memory message, bytes memory options)
    {
        string memory uri = IERC721MetadataURI(address(innerToken)).tokenURI(sendParam.tokenId);
        return _buildMsgAndOptionsWithUri(sendParam, uri);
    }

    function _buildMsgAndOptionsWithUri(SendParam calldata sendParam, string memory uri)
        internal
        view
        returns (bytes memory message, bytes memory options)
    {
        if (sendParam.to == bytes32(0)) revert InvalidReceiver();

        bytes memory composeMsg = abi.encode(uri);
        bool hasCompose;
        (message, hasCompose) = ONFT721MsgCodec.encode(sendParam.to, sendParam.tokenId, composeMsg);
        uint16 msgType = hasCompose ? SEND_AND_COMPOSE : SEND;
        options = combineOptions(sendParam.dstEid, msgType, sendParam.extraOptions);

        address inspector = msgInspector;
        if (inspector != address(0)) IOAppMsgInspector(inspector).inspect(message, options);
    }

    /// @dev Defensive tail slice; callers only invoke when `data.length > offset`.
    function _memoryTail(bytes memory data, uint256 offset) internal pure returns (bytes memory tail) {
        if (data.length < offset) revert ComposeMsgTooShort();
        tail = new bytes(data.length - offset);
        for (uint256 i = 0; i < tail.length; i++) {
            tail[i] = data[offset + i];
        }
    }
}
