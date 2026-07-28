// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC-20 with constructor-configurable decimals for payment-token precision tests.
contract MockERC20Decimals is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Conforming ERC-20 that reverts on `decimals()` — not admissible as a payment token.
contract NoDecimalsErc20 is ERC20 {
    constructor() ERC20("No Decimals", "NODEC") {}

    function decimals() public pure override returns (uint8) {
        revert();
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
