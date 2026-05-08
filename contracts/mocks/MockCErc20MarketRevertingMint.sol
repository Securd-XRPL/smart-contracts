// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CTokenInterface} from "../core/CTokenInterfaces.sol";

/// @dev Like MockCErc20Market but mint() can be set to revert, used to test that
///      XRPLSecurdBridgeAdapter._supply resets the token approval even on mint failure.
contract MockCErc20MarketRevertingMint {
    IERC20 public immutable underlying;
    bool public mintReverts;

    constructor(address underlying_) {
        underlying = IERC20(underlying_);
    }

    function setMintReverts(bool reverts_) external {
        mintReverts = reverts_;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        if (mintReverts) revert("mint: forced revert");
        underlying.transferFrom(msg.sender, address(this), mintAmount);
        return 0;
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), repayAmount);
        return 0;
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        underlying.transfer(msg.sender, borrowAmount);
        return 0;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        underlying.transfer(msg.sender, redeemAmount);
        return 0;
    }

    function liquidateBorrow(address, uint256 repayAmount, CTokenInterface) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), repayAmount);
        return 0;
    }

    function comptroller() external view returns (address) {
        return address(this);
    }

    function enterMarkets(address[] calldata) external returns (uint[] memory results) {
        results = new uint[](1);
        results[0] = 0;
    }
}
