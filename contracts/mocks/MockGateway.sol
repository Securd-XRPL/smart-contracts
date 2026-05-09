// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockGateway {
    address public immutable deployer;
    bool public nextValidationResult = true;

    constructor() {
        deployer = msg.sender;
    }

    function setNextValidationResult(bool allowed) external {
        require(msg.sender == deployer, "only deployer");
        nextValidationResult = allowed;
    }

    function validateContractCall(bytes32, string calldata, string calldata, bytes32) external view returns (bool) {
        return nextValidationResult;
    }
}
