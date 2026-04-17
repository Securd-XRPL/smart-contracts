// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockGateway {
    bool public nextValidationResult = true;

    function setNextValidationResult(bool allowed) external {
        nextValidationResult = allowed;
    }

    function validateContractCall(bytes32, string calldata, string calldata, bytes32) external view returns (bool) {
        return nextValidationResult;
    }
}
