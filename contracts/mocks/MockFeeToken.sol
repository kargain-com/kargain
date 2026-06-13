// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 with configurable transfer fee for testing fee-on-transfer accounting.
contract MockFeeToken is ERC20 {
    uint256 public immutable feeBps;

    address private constant _FEE_SINK = 0x000000000000000000000000000000000000dEaD;

    constructor(uint256 feeBps_) ERC20("Mock Fee Token", "MFT") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (amount * feeBps) / 10_000;
            uint256 net = amount - fee;
            super._update(from, to, net);
            if (fee > 0) {
                super._update(from, _FEE_SINK, fee);
            }
            return;
        }
        super._update(from, to, amount);
    }
}
