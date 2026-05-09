// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAxelarGateway} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol";

/// @title XrplEvmDemoReceiver
/// @notice Minimal XRPL Ledger → XRPL EVM demo contract.
///         Handles both pure GMP messages (no tokens) and ITS token transfers with an embedded GMP payload.
///
/// GMP flow (call_contract):
///   XRPL Payment → Axelar gateway → execute(commandId, sourceChain, sourceAddress, payload)
///   payload = abi.encode(senderAddressString, message, xrpDrops)
///
/// ITS + GMP flow (interchain_transfer with payload memo):
///   XRPL Payment → Axelar ITS → executeWithInterchainToken(commandId, sourceChain, sourceAddress,
///                                                           data, tokenId, token, amount)
///   data = abi.encode(senderAddressString, message, xrpDrops)
contract XrplEvmDemoReceiver is Ownable {
    error InvalidGateway();
    error InvalidIts();
    error NotInterchainTokenService();
    error NotApprovedByGateway();
    error UntrustedSource(bytes32 sourceId);

    event TrustedGmpSourceSet(bytes32 indexed sourceId, string sourceChain, string sourceAddress, bool trusted);
    event TrustedItsSourceSet(bytes32 indexed sourceId, string sourceChain, bytes sourceAddress, bool trusted);

    event GmpMessageReceived(
        bytes32 indexed commandId,
        string sourceChain,
        string sourceAddress,
        string sender,
        string message,
        uint256 xrpDrops
    );

    event ItsTransferReceived(
        bytes32 indexed commandId,
        string sourceChain,
        bytes32 indexed tokenId,
        address indexed token,
        uint256 amount,
        string sender,
        string message,
        uint256 xrpDrops
    );

    struct LastGmpMessage {
        bytes32 commandId;
        string sourceChain;
        string sourceAddress;
        string sender;
        string message;
        uint256 xrpDrops;
        uint256 receivedAt;
    }

    struct LastItsTransfer {
        bytes32 commandId;
        string sourceChain;
        bytes32 tokenId;
        address token;
        uint256 amount;
        string sender;
        string message;
        uint256 xrpDrops;
        uint256 receivedAt;
    }

    IAxelarGateway public immutable gateway;
    address public immutable interchainTokenService;

    mapping(bytes32 => bool) public trustedGmpSource;
    mapping(bytes32 => bool) public trustedItsSource;

    LastGmpMessage private _lastGmpMessage;
    LastItsTransfer private _lastItsTransfer;
    uint256 public totalGmpMessages;
    uint256 public totalItsTransfers;

    constructor(address initialOwner, address gateway_, address interchainTokenService_) {
        require(initialOwner != address(0), "owner=0");
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
        if (gateway_ == address(0)) revert InvalidGateway();
        if (interchainTokenService_ == address(0)) revert InvalidIts();
        gateway = IAxelarGateway(gateway_);
        interchainTokenService = interchainTokenService_;
    }

    // ─── Configuration ───────────────────────────────────────────────────────

    function setTrustedGmpSource(string calldata sourceChain, string calldata sourceAddress, bool trusted)
        external
        onlyOwner
    {
        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        trustedGmpSource[sourceId] = trusted;
        emit TrustedGmpSourceSet(sourceId, sourceChain, sourceAddress, trusted);
    }

    function setTrustedItsSource(string calldata sourceChain, bytes calldata sourceAddress, bool trusted)
        external
        onlyOwner
    {
        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        trustedItsSource[sourceId] = trusted;
        emit TrustedItsSourceSet(sourceId, sourceChain, sourceAddress, trusted);
    }

    // ─── Axelar GMP entry point ───────────────────────────────────────────────

    /// @notice Called by the Axelar gateway for pure GMP messages (no token transfer).
    function execute(
        bytes32 commandId,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) external {
        if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, keccak256(payload))) {
            revert NotApprovedByGateway();
        }

        (string memory sender, string memory message, uint256 xrpDrops) =
            abi.decode(payload, (string, string, uint256));

        _lastGmpMessage = LastGmpMessage({
            commandId: commandId,
            sourceChain: sourceChain,
            sourceAddress: sourceAddress,
            sender: sender,
            message: message,
            xrpDrops: xrpDrops,
            receivedAt: block.timestamp
        });
        totalGmpMessages++;

        emit GmpMessageReceived(commandId, sourceChain, sourceAddress, sender, message, xrpDrops);
    }

    // ─── Axelar ITS entry point ───────────────────────────────────────────────

    /// @notice Called by the Axelar ITS for token transfers that carry a GMP payload.
    function executeWithInterchainToken(
        bytes32 commandId,
        string calldata sourceChain,
        bytes calldata sourceAddress,
        bytes calldata data,
        bytes32 tokenId,
        address token,
        uint256 amount
    ) external returns (bytes32) {
        if (msg.sender != interchainTokenService) revert NotInterchainTokenService();

        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        if (!trustedItsSource[sourceId]) revert UntrustedSource(sourceId);

        _storeItsTransfer(commandId, sourceChain, tokenId, token, amount, data);
        return keccak256("its-execute-success");
    }

    function _storeItsTransfer(
        bytes32 commandId,
        string calldata sourceChain,
        bytes32 tokenId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal {
        (string memory sender, string memory message, uint256 xrpDrops) =
            abi.decode(data, (string, string, uint256));

        _lastItsTransfer = LastItsTransfer({
            commandId: commandId,
            sourceChain: sourceChain,
            tokenId: tokenId,
            token: token,
            amount: amount,
            sender: sender,
            message: message,
            xrpDrops: xrpDrops,
            receivedAt: block.timestamp
        });
        totalItsTransfers++;

        emit ItsTransferReceived(commandId, sourceChain, tokenId, token, amount, sender, message, xrpDrops);
    }

    // ─── Inspection ──────────────────────────────────────────────────────────

    function lastGmpMessage() external view returns (LastGmpMessage memory) {
        return _lastGmpMessage;
    }

    function lastItsTransfer() external view returns (LastItsTransfer memory) {
        return _lastItsTransfer;
    }

    /// @notice Withdraws any native XRP accidentally sent to this contract.
    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "native transfer failed");
    }

    receive() external payable {}
}
