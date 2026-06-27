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

import {ONFT721Core} from "@layerzerolabs/onft-evm/contracts/onft721/ONFT721Core.sol";
import {Origin} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {ONFT721MsgCodec} from "@layerzerolabs/onft-evm/contracts/onft721/libs/ONFT721MsgCodec.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title KarPassportONFT721
/// @notice Spoke-chain KarPassport ONFT — mint/burn with per-token URI from bridge payload.
/// @dev Overrides `_lzReceive` to set tokenURI from abi.encode(string) extension without compose delivery.
/// @custom:version 1.0.0-rc.1
contract KarPassportONFT721 is ONFT721Core, ERC721URIStorage {
    string public constant VERSION = "1.0.0-rc.1";

    using ONFT721MsgCodec for bytes;
    using ONFT721MsgCodec for bytes32;

    uint8 private constant _SENDER_BYTES = 32;

    error ComposeMsgTooShort();

    /// @notice Deploys spoke-chain ONFT KarPassport.
    /// @param lzEndpoint LayerZero EndpointV2 address.
    /// @param delegate OApp delegate (typically owner).
    constructor(address lzEndpoint, address delegate)
        ERC721("KarPassport", "KPPT")
        ONFT721Core(lzEndpoint, delegate)
    {}

    /// @notice Retrieves the address of the underlying ERC721 implementation (this contract).
    function token() external view returns (address) {
        return address(this);
    }

    /// @notice ONFT721 is the token; approval is not required to send.
    function approvalRequired() external pure returns (bool) {
        return false;
    }

    /// @inheritdoc ONFT721Core
    function _debit(address from, uint256 tokenId, uint32 /*dstEid*/) internal virtual override {
        if (from != ownerOf(tokenId)) revert OnlyNFTOwner(from, ownerOf(tokenId));
        _burn(tokenId);
    }

    /// @inheritdoc ONFT721Core
    function _credit(address to, uint256 tokenId, uint32 /*srcEid*/) internal virtual override {
        _mint(to, tokenId);
    }

    /// @inheritdoc ONFT721Core
    function _lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address executor,
        bytes calldata extraData
    ) internal virtual override {
        address toAddress = message.sendTo().bytes32ToAddress();
        uint256 tokenId = message.tokenId();

        _credit(toAddress, tokenId, origin.srcEid);

        if (message.isComposed()) {
            bytes memory extension = message.composeMsg();
            if (extension.length > _SENDER_BYTES) {
                string memory uri = abi.decode(_memoryTail(extension, _SENDER_BYTES), (string));
                _setTokenURI(tokenId, uri);
            }
        }

        emit ONFTReceived(guid, origin.srcEid, toAddress, tokenId);
        executor;
        extraData;
    }

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId) public view override(ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function _memoryTail(bytes memory data, uint256 offset) internal pure returns (bytes memory tail) {
        if (data.length < offset) revert ComposeMsgTooShort();
        tail = new bytes(data.length - offset);
        for (uint256 i = 0; i < tail.length; i++) {
            tail[i] = data[offset + i];
        }
    }
}
