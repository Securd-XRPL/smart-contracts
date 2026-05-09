// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CTokenInterface} from "../core/CTokenInterfaces.sol";

contract MockCErc20Market {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    address public immutable deployer;
    uint256 public nextMintResult;
    uint256 public nextRepayResult;
    uint256 public nextBorrowResult;
    uint256 public nextRedeemResult;
    uint256 public nextLiquidationResult;

    constructor(address underlying_) {
        underlying = IERC20(underlying_);
        deployer = msg.sender;
    }

    function setResults(
        uint256 mintResult,
        uint256 repayResult,
        uint256 borrowResult,
        uint256 redeemResult,
        uint256 liquidationResult
    ) external {
        require(msg.sender == deployer, "only deployer");
        nextMintResult = mintResult;
        nextRepayResult = repayResult;
        nextBorrowResult = borrowResult;
        nextRedeemResult = redeemResult;
        nextLiquidationResult = liquidationResult;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        underlying.safeTransferFrom(msg.sender, address(this), mintAmount);
        return nextMintResult;
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        underlying.safeTransferFrom(msg.sender, address(this), repayAmount);
        return nextRepayResult;
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        underlying.safeTransfer(msg.sender, borrowAmount);
        return nextBorrowResult;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        underlying.safeTransfer(msg.sender, redeemAmount);
        return nextRedeemResult;
    }

    function liquidateBorrow(address, uint256 repayAmount, CTokenInterface) external returns (uint256) {
        underlying.safeTransferFrom(msg.sender, address(this), repayAmount);
        return nextLiquidationResult;
    }

    // Acts as its own mock comptroller so the adapter can call comptroller().enterMarkets() in tests.
    function comptroller() external view returns (address) {
        return address(this);
    }

    function enterMarkets(address[] calldata) external returns (uint[] memory results) {
        results = new uint[](1);
        results[0] = 0;
    }
}
