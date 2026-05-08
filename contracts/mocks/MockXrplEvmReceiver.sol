// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAxelarGateway} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol";

/// @notice Minimal XRPL Ledger -> XRPL EVM GMP receiver used to isolate bridge plumbing.
contract MockXrplEvmReceiver is Ownable {
    error InvalidGateway();
    error NotGateway();
    error NotApprovedByGateway();
    error UntrustedSource(bytes32 sourceId);

    event TrustedSourceSet(bytes32 indexed sourceId, string sourceChain, string sourceAddress, bool trusted);
    event XrplLedgerMessageReceived(
        bytes32 indexed commandId,
        string sourceChain,
        string sourceAddress,
        bytes32 indexed xrplAccount,
        string memo,
        uint256 amount
    );

    struct LastMessage {
        bytes32 commandId;
        string sourceChain;
        string sourceAddress;
        bytes32 xrplAccount;
        string memo;
        uint256 amount;
        bytes payload;
    }

    IAxelarGateway public immutable gateway;
    mapping(bytes32 => bool) public trustedSource;
    LastMessage private lastMessage;

    constructor(address initialOwner, address gateway_) {
        require(initialOwner != address(0), "owner=0");
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
        if (gateway_ == address(0)) revert InvalidGateway();
        gateway = IAxelarGateway(gateway_);
    }

    function setTrustedSource(string calldata sourceChain, string calldata sourceAddress, bool trusted)
        external
        onlyOwner
    {
        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        trustedSource[sourceId] = trusted;
        emit TrustedSourceSet(sourceId, sourceChain, sourceAddress, trusted);
    }

    function execute(bytes32 commandId, string calldata sourceChain, string calldata sourceAddress, bytes calldata payload)
        external
    {
        if (msg.sender != address(gateway)) revert NotGateway();

        bytes32 payloadHash = keccak256(payload);
        if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, payloadHash)) {
            revert NotApprovedByGateway();
        }

        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        if (!trustedSource[sourceId]) revert UntrustedSource(sourceId);

        (bytes32 xrplAccount, string memory memo, uint256 amount) = abi.decode(payload, (bytes32, string, uint256));
        lastMessage = LastMessage({
            commandId: commandId,
            sourceChain: sourceChain,
            sourceAddress: sourceAddress,
            xrplAccount: xrplAccount,
            memo: memo,
            amount: amount,
            payload: payload
        });

        emit XrplLedgerMessageReceived(commandId, sourceChain, sourceAddress, xrplAccount, memo, amount);
    }

    function lastReceivedMessage() external view returns (LastMessage memory) {
        return lastMessage;
    }
}
