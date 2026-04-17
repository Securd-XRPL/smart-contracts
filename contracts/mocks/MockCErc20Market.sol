// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CTokenInterface} from "../core/CTokenInterfaces.sol";

contract MockCErc20Market {
    IERC20 public immutable underlying;
    uint256 public nextMintResult;
    uint256 public nextRepayResult;
    uint256 public nextBorrowResult;
    uint256 public nextRedeemResult;
    uint256 public nextLiquidationResult;

    constructor(address underlying_) {
        underlying = IERC20(underlying_);
    }

    function setResults(
        uint256 mintResult,
        uint256 repayResult,
        uint256 borrowResult,
        uint256 redeemResult,
        uint256 liquidationResult
    ) external {
        nextMintResult = mintResult;
        nextRepayResult = repayResult;
        nextBorrowResult = borrowResult;
        nextRedeemResult = redeemResult;
        nextLiquidationResult = liquidationResult;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), mintAmount);
        return nextMintResult;
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), repayAmount);
        return nextRepayResult;
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        underlying.transfer(msg.sender, borrowAmount);
        return nextBorrowResult;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        underlying.transfer(msg.sender, redeemAmount);
        return nextRedeemResult;
    }

    function liquidateBorrow(address, uint256 repayAmount, CTokenInterface) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), repayAmount);
        return nextLiquidationResult;
    }
}
