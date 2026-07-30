// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Mock Korean Won
/// @notice Test-only payment token. It has no real-world monetary value.
contract MockKRW is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000;

    constructor()
        ERC20("Mock Korean Won", "mKRW")
        Ownable(msg.sender)
    {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Uses one token unit as one KRW for the integer-only MVP amount model.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Mints test funds to a demo wallet.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
