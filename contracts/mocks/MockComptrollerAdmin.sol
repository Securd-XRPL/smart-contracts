// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Minimal mock that simulates the Unitroller admin handoff and _setCollateralFactor,
///      used only in SecurdCollateralFactorTimelock unit tests.
contract MockComptrollerAdmin {
    address public admin;
    address public pendingAdmin;

    uint256 public lastCollateralFactorMantissa;
    address public lastCollateralFactorCToken;
    uint256 public nextErrorCode; // set to non-zero to simulate failure

    constructor() {
        admin = msg.sender;
    }

    function _setPendingAdmin(address newPendingAdmin) external returns (uint256) {
        pendingAdmin = newPendingAdmin;
        return 0;
    }

    function _acceptAdmin() external returns (uint256) {
        require(msg.sender == pendingAdmin, "not pending admin");
        admin = pendingAdmin;
        pendingAdmin = address(0);
        return nextErrorCode;
    }

    function _setCollateralFactor(address cToken, uint256 newCollateralFactorMantissa) external returns (uint256) {
        if (nextErrorCode != 0) return nextErrorCode;
        lastCollateralFactorCToken = cToken;
        lastCollateralFactorMantissa = newCollateralFactorMantissa;
        return 0;
    }

    function setNextErrorCode(uint256 code) external {
        nextErrorCode = code;
    }
}
