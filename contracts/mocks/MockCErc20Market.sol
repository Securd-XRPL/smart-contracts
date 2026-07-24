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

    // Simulates Compound V2's per-account borrow balance and cToken balance so tests can exercise
    // the "repay all" (type(uint256).max) and "withdraw all" (redeem full cToken balance) sentinels.
    mapping(address => uint256) public borrowBalanceOf;
    mapping(address => uint256) public balanceOf;
    uint256 public exchangeRateMantissa = 1e18;

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

    function setBorrowBalance(address account, uint256 balance) external {
        require(msg.sender == deployer, "only deployer");
        borrowBalanceOf[account] = balance;
    }

    function setCTokenBalance(address account, uint256 balance) external {
        require(msg.sender == deployer, "only deployer");
        balanceOf[account] = balance;
    }

    function setExchangeRateMantissa(uint256 mantissa) external {
        require(msg.sender == deployer, "only deployer");
        exchangeRateMantissa = mantissa;
    }

    function borrowBalanceCurrent(address account) external view returns (uint256) {
        return borrowBalanceOf[account];
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        underlying.safeTransferFrom(msg.sender, address(this), mintAmount);
        return nextMintResult;
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        // Mirrors CToken.repayBorrowFresh: type(uint256).max caps the pull at the live borrow balance.
        uint256 actualRepayAmount = repayAmount == type(uint256).max ? borrowBalanceOf[msg.sender] : repayAmount;
        underlying.safeTransferFrom(msg.sender, address(this), actualRepayAmount);
        borrowBalanceOf[msg.sender] -= actualRepayAmount;
        return nextRepayResult;
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        underlying.safeTransfer(msg.sender, borrowAmount);
        borrowBalanceOf[msg.sender] += borrowAmount;
        return nextBorrowResult;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        underlying.safeTransfer(msg.sender, redeemAmount);
        return nextRedeemResult;
    }

    function redeem(uint256 redeemTokens) external returns (uint256) {
        uint256 redeemAmount = (redeemTokens * exchangeRateMantissa) / 1e18;
        balanceOf[msg.sender] -= redeemTokens;
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
