// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title XRPLUserProxy
/// @notice Minimal execution wallet controlled by the bridge adapter for a single XRPL account.
/// @dev The proxy isolates balances and market positions per bridged user while keeping the core protocol unchanged.
contract XRPLUserProxy {
    error NotController();
    error CallFailed(bytes returndata);
    error TokenTransferFailed();

    event Executed(address indexed target, uint256 value, bytes data);

    address public immutable controller;
    bytes32 public immutable xrplAccount;

    /// @param controller_ Bridge adapter allowed to execute calls through the proxy.
    /// @param xrplAccount_ Canonical XRPL account identifier represented by this proxy.
    constructor(address controller_, bytes32 xrplAccount_) {
        controller = controller_;
        xrplAccount = xrplAccount_;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    /// @notice Executes an arbitrary call on behalf of the proxied XRPL user.
    /// @param target Destination contract to call.
    /// @param value Native value to forward with the call.
    /// @param data Calldata sent to the destination contract.
    /// @return returndata Raw bytes returned by the destination call.
    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyController
        returns (bytes memory returndata)
    {
        (bool ok, bytes memory out) = target.call{value: value}(data);
        if (!ok) revert CallFailed(out);

        emit Executed(target, value, data);
        return out;
    }

    /// @notice Sweeps ERC20 tokens held by the proxy.
    /// @param token ERC20 token to transfer.
    /// @param to Recipient of the swept tokens.
    /// @param amount Amount of tokens to transfer.
    function sweepToken(address token, address to, uint256 amount) external onlyController {
        // Reject EOA token addresses: a call to an EOA returns (true, "") giving false success.
        if (token.code.length == 0) revert TokenTransferFailed();
        (bool ok, bytes memory out) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok) revert TokenTransferFailed();
        if (out.length > 0 && !abi.decode(out, (bool))) revert TokenTransferFailed();
    }

    receive() external payable {}
}
