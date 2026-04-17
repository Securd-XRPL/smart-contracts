// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockCTokenWithUnderlying {
    address public immutable underlying;

    constructor(address underlying_) {
        underlying = underlying_;
    }
}
