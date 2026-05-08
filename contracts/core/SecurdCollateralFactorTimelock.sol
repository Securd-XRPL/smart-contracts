// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IComptrollerAdmin {
    function _setCollateralFactor(address cToken, uint256 newCollateralFactorMantissa) external returns (uint256);
}

interface IUnitrollerAdmin {
    function _acceptAdmin() external returns (uint256);
    function admin() external view returns (address);
}

/// @title SecurdCollateralFactorTimelock
/// @notice Enforces a mandatory delay before any collateral factor change takes effect.
///
/// Deployment flow:
///   1. Deploy this contract (owner = multisig).
///   2. Current Unitroller admin calls `unitroller._setPendingAdmin(timeLockAddress)`.
///   3. Call `acceptUnitrollerAdmin(unitrollerAddress)` to complete the handoff.
///   4. All future `_setCollateralFactor` calls must go through this contract.
///
/// Collateral factor changes require at least `MIN_DELAY` between `queue` and `execute`.
/// Any other comptroller admin call (oracle update, close factor, etc.) can be queued
/// with a `delay` of 0 and executed immediately — the time-sensitivity constraint only
/// applies to collateral factor changes because they can retroactively make borrowers liquidatable.
contract SecurdCollateralFactorTimelock is Ownable {
    /// @notice Minimum delay enforced for collateral factor changes (48 hours).
    uint256 public constant MIN_DELAY = 48 hours;

    /// @notice Maximum delay that can be set for any queued action (30 days).
    uint256 public constant MAX_DELAY = 30 days;

    bytes4 private constant SET_COLLATERAL_FACTOR_SELECTOR =
        bytes4(keccak256("_setCollateralFactor(address,uint256)"));

    struct QueuedAction {
        address target;
        uint256 value;
        bytes data;
        uint256 eta; // earliest block.timestamp at which the action can be executed
        bool exists;
    }

    error ActionNotQueued(bytes32 actionId);
    error ActionAlreadyQueued(bytes32 actionId);
    error ActionNotReady(bytes32 actionId, uint256 eta, uint256 now_);
    error ActionExpired(bytes32 actionId, uint256 eta);
    error DelayTooShort(uint256 provided, uint256 minimum);
    error DelayTooLong(uint256 provided, uint256 maximum);
    error ExecutionFailed(bytes32 actionId, bytes returnData);
    error InvalidTarget();

    event ActionQueued(bytes32 indexed actionId, address indexed target, bytes data, uint256 eta);
    event ActionExecuted(bytes32 indexed actionId, address indexed target, bytes data);
    event ActionCancelled(bytes32 indexed actionId);
    event UnitrollerAdminAccepted(address indexed unitroller);

    /// @notice Grace period after `eta` during which an action can still be executed (7 days).
    uint256 public constant GRACE_PERIOD = 7 days;

    mapping(bytes32 => QueuedAction) public queuedActions;

    constructor(address initialOwner) {
        require(initialOwner != address(0), "owner=0");
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
    }

    /// @notice Completes the Unitroller admin handoff by calling `_acceptAdmin` on the proxy.
    /// @dev Must be called after the previous admin has set this contract as pending admin.
    function acceptUnitrollerAdmin(address unitroller) external onlyOwner {
        if (unitroller == address(0)) revert InvalidTarget();
        uint256 err = IUnitrollerAdmin(unitroller)._acceptAdmin();
        require(err == 0, "acceptAdmin failed");
        emit UnitrollerAdminAccepted(unitroller);
    }

    /// @notice Queues an arbitrary admin call to be executed after `delay` seconds.
    /// @dev Collateral factor changes (`_setCollateralFactor`) require `delay >= MIN_DELAY`.
    ///      All other calls may use `delay = 0` for immediate execution.
    /// @param target Contract to call (typically the Comptroller proxy address).
    /// @param value Native value to forward (usually 0).
    /// @param data ABI-encoded call data for the admin function.
    /// @param delay Seconds from now before this action can be executed.
    /// @return actionId Unique identifier for the queued action.
    function queue(address target, uint256 value, bytes calldata data, uint256 delay)
        external
        onlyOwner
        returns (bytes32 actionId)
    {
        if (target == address(0)) revert InvalidTarget();
        if (delay > MAX_DELAY) revert DelayTooLong(delay, MAX_DELAY);

        // Collateral factor changes must observe the minimum delay.
        bool isCollateralFactorChange = data.length >= 4 &&
            bytes4(data[:4]) == SET_COLLATERAL_FACTOR_SELECTOR;
        if (isCollateralFactorChange && delay < MIN_DELAY) {
            revert DelayTooShort(delay, MIN_DELAY);
        }

        uint256 eta = block.timestamp + delay;
        actionId = keccak256(abi.encode(target, value, data, eta));

        if (queuedActions[actionId].exists) revert ActionAlreadyQueued(actionId);

        queuedActions[actionId] = QueuedAction({
            target: target,
            value: value,
            data: data,
            eta: eta,
            exists: true
        });

        emit ActionQueued(actionId, target, data, eta);
    }

    /// @notice Executes a previously queued action once its delay has elapsed.
    /// @param actionId Identifier returned by `queue`.
    function execute(bytes32 actionId) external onlyOwner {
        QueuedAction storage action = queuedActions[actionId];
        if (!action.exists) revert ActionNotQueued(actionId);
        if (block.timestamp < action.eta) revert ActionNotReady(actionId, action.eta, block.timestamp);
        if (block.timestamp > action.eta + GRACE_PERIOD) revert ActionExpired(actionId, action.eta);

        address target = action.target;
        uint256 value = action.value;
        bytes memory data = action.data;

        delete queuedActions[actionId];

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert ExecutionFailed(actionId, ret);

        emit ActionExecuted(actionId, target, data);
    }

    /// @notice Cancels a queued action before it is executed.
    /// @param actionId Identifier returned by `queue`.
    function cancel(bytes32 actionId) external onlyOwner {
        if (!queuedActions[actionId].exists) revert ActionNotQueued(actionId);
        delete queuedActions[actionId];
        emit ActionCancelled(actionId);
    }

    receive() external payable {}
}
