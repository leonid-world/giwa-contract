// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MockKRW Demo Faucet
/// @notice Distributes a fixed amount of pre-funded, test-only mKRW once per wallet.
contract MockKRWFaucet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable paymentToken;
    uint256 public immutable claimAmount;

    mapping(address account => bool claimed) public hasClaimed;

    error InvalidPaymentToken();
    error InvalidClaimAmount();
    error AlreadyClaimed(address account);
    error FaucetDepleted(uint256 available, uint256 required);
    error NothingToWithdraw();

    event Claimed(address indexed account, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);

    constructor(address paymentTokenAddress, uint256 claimAmount_)
        Ownable(msg.sender)
    {
        if (
            paymentTokenAddress == address(0) ||
            paymentTokenAddress.code.length == 0
        ) {
            revert InvalidPaymentToken();
        }
        if (claimAmount_ == 0) revert InvalidClaimAmount();

        paymentToken = IERC20(paymentTokenAddress);
        claimAmount = claimAmount_;
    }

    /// @notice Sends the configured amount to the caller once.
    function claim() external nonReentrant {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed(msg.sender);

        uint256 available = paymentToken.balanceOf(address(this));
        if (available < claimAmount) {
            revert FaucetDepleted(available, claimAmount);
        }

        hasClaimed[msg.sender] = true;
        paymentToken.safeTransfer(msg.sender, claimAmount);

        emit Claimed(msg.sender, claimAmount);
    }

    /// @notice Recovers the remaining demo inventory when the faucet is retired.
    function withdrawAll() external onlyOwner nonReentrant {
        uint256 available = paymentToken.balanceOf(address(this));
        if (available == 0) revert NothingToWithdraw();

        paymentToken.safeTransfer(owner(), available);

        emit Withdrawn(owner(), available);
    }
}
