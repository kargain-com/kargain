// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAuctionEscrow} from "../interfaces/IAuctionEscrow.sol";

interface IClaimWithdraw {
    function withdrawClaim(address asset) external;
}

/// @notice Burns all forwarded gas in receive until acceptEth is set — proves push stipend cannot OOG the payer.
contract GasBurningRecipient {
    bool public acceptEth;

    function setAcceptEth(bool value) external {
        acceptEth = value;
    }

    receive() external payable {
        if (acceptEth) return;
        while (true) {}
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0x150b7a02);
    }

    function withdrawClaim(address target, address asset) external {
        IClaimWithdraw(target).withdrawClaim(asset);
    }

    function joinNative(
        address staking,
        uint8 category,
        string calldata name,
        string calldata metadataURI
    ) external payable {
        (bool ok,) = staking.call{value: msg.value}(
            abi.encodeWithSignature(
                "becomeVerifierNative(uint8,string,string)", category, name, metadataURI
            )
        );
        require(ok, "joinNative failed");
    }

    function leaveStaking(address staking) external {
        (bool ok,) = staking.call(abi.encodeWithSignature("leave()"));
        require(ok, "leave failed");
    }

    function claimStake(address staking) external {
        (bool ok,) = staking.call(abi.encodeWithSignature("claimStake()"));
        require(ok, "claimStake failed");
    }
}

/// @notice Auction bidder that burns gas on outbid refund receive.
contract GasBurningBidder {
    IAuctionEscrow public immutable escrow;
    bool public acceptEth;

    constructor(IAuctionEscrow escrow_) {
        escrow = escrow_;
    }

    function setAcceptEth(bool value) external {
        acceptEth = value;
    }

    function bidNative(uint256 tokenId) external payable {
        escrow.bid{value: msg.value}(tokenId, uint128(msg.value));
    }

    function withdrawClaim(address asset) external {
        IClaimWithdraw(address(escrow)).withdrawClaim(asset);
    }

    receive() external payable {
        if (acceptEth) return;
        while (true) {}
    }
}

/// @notice ERC-20 whose transfer returns 31 bytes — fails Erc20Admission.
contract NonConformingErc20 {
    function transfer(address, uint256) external pure {
        assembly {
            mstore(0x00, 1)
            return(0x00, 31)
        }
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @notice ERC-20 that returns false even for zero-amount transfer — fails admission.
contract NonConformingErc20ReturnsFalse {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @notice Conforming at admission (`transfer(this,0)` ok) but can return false for later payouts.
contract SelectiveFailErc20 is ERC20 {
    address public failTo;

    constructor() ERC20("Selective Fail", "SFAIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTo(address to) external {
        failTo = to;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTo != address(0) && to == failTo && amount > 0) {
            return false;
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (failTo != address(0) && to == failTo && amount > 0) {
            return false;
        }
        return super.transferFrom(from, to, amount);
    }
}
