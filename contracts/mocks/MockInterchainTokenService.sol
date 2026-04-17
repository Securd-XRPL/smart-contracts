// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockInterchainTokenService {
    struct TransferCall {
        bytes32 tokenId;
        string destinationChain;
        bytes destinationAddress;
        uint256 amount;
        bytes metadata;
        uint256 gasValue;
        uint256 msgValue;
    }

    TransferCall public lastTransfer;

    function interchainTransfer(
        bytes32 tokenId,
        string calldata destinationChain,
        bytes calldata destinationAddress,
        uint256 amount,
        bytes calldata metadata,
        uint256 gasValue
    ) external payable {
        lastTransfer = TransferCall({
            tokenId: tokenId,
            destinationChain: destinationChain,
            destinationAddress: destinationAddress,
            amount: amount,
            metadata: metadata,
            gasValue: gasValue,
            msgValue: msg.value
        });
    }
}
