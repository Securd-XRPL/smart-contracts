// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CErc20Interface, CTokenInterface} from "./CTokenInterfaces.sol";

/// @title SecurdLiquidationKeeper
/// @notice Optional treasury wrapper for protocol-operated liquidations on XRPL EVM.
/// @dev This contract does not replace the core liquidation path. It only custody-manages
///      repay assets, keeper permissions, and simple execution limits around the standard
///      `liquidateBorrow` call on ERC20-backed Securd markets.
contract SecurdLiquidationKeeper is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotKeeper();
    error InvalidAsset();
    error InvalidMarket();
    error InvalidBorrower();
    error InvalidRepayAmount();
    error AssetLimitExceeded(address asset, uint256 limit, uint256 requested);
    error MarketLimitExceeded(address market, uint256 limit, uint256 requested);
    error LiquidationCallFailed(uint256 errorCode);

    event KeeperSet(address indexed keeper, bool allowed);
    event AssetLimitSet(address indexed asset, uint256 previousLimit, uint256 newLimit);
    event MarketLimitSet(address indexed market, uint256 previousLimit, uint256 newLimit);
    event TreasuryFunded(address indexed asset, address indexed from, uint256 amount);
    event LiquidationExecuted(
        address indexed keeper,
        address indexed borrowedMarket,
        address indexed borrower,
        address collateralMarket,
        address repayAsset,
        uint256 repayAmount
    );
    event AssetSwept(address indexed asset, address indexed to, uint256 amount);

    mapping(address => bool) public isKeeper;
    mapping(address => uint256) public maxRepayPerAsset;
    mapping(address => uint256) public maxRepayPerMarket;

    constructor(address initialOwner) {
        require(initialOwner != address(0), "owner=0");
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != owner() && !isKeeper[msg.sender]) revert NotKeeper();
        _;
    }

    /// @notice Grants or revokes keeper permissions for a liquidation executor.
    function setKeeper(address keeper, bool allowed) external onlyOwner {
        require(keeper != address(0), "keeper=0");
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    /// @notice Sets the maximum repay amount allowed per repay asset in a single liquidation.
    /// @dev A zero limit disables liquidations for the asset.
    function setAssetLimit(address asset, uint256 newLimit) external onlyOwner {
        if (asset == address(0)) revert InvalidAsset();
        uint256 previous = maxRepayPerAsset[asset];
        maxRepayPerAsset[asset] = newLimit;
        emit AssetLimitSet(asset, previous, newLimit);
    }

    /// @notice Sets the maximum repay amount allowed per borrowed market in a single liquidation.
    /// @dev A zero limit disables liquidations for the market.
    function setMarketLimit(address market, uint256 newLimit) external onlyOwner {
        if (market == address(0)) revert InvalidMarket();
        uint256 previous = maxRepayPerMarket[market];
        maxRepayPerMarket[market] = newLimit;
        emit MarketLimitSet(market, previous, newLimit);
    }

    /// @notice Pulls repay assets into the keeper treasury.
    function fund(address asset, uint256 amount) external onlyOwner whenNotPaused {
        if (asset == address(0)) revert InvalidAsset();
        if (amount == 0) revert InvalidRepayAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryFunded(asset, msg.sender, amount);
    }

    /// @notice Executes a standard ERC20 market liquidation using treasury-held repay assets.
    /// @param borrowedMarket ERC20 borrowed market address.
    /// @param borrower Borrower account to liquidate.
    /// @param repayAmount Underlying amount to repay.
    /// @param collateralMarket Collateral market whose tokens will be seized.
    function executeLiquidation(
        address borrowedMarket,
        address borrower,
        uint256 repayAmount,
        address collateralMarket
    ) external onlyKeeperOrOwner whenNotPaused nonReentrant {
        if (borrowedMarket == address(0)) revert InvalidMarket();
        if (collateralMarket == address(0)) revert InvalidMarket();
        if (borrower == address(0)) revert InvalidBorrower();
        if (repayAmount == 0) revert InvalidRepayAmount();

        address repayAsset = CErc20Interface(borrowedMarket).underlying();
        if (repayAsset == address(0)) revert InvalidAsset();

        uint256 assetLimit = maxRepayPerAsset[repayAsset];
        if (assetLimit == 0 || repayAmount > assetLimit) {
            revert AssetLimitExceeded(repayAsset, assetLimit, repayAmount);
        }

        uint256 marketLimit = maxRepayPerMarket[borrowedMarket];
        if (marketLimit == 0 || repayAmount > marketLimit) {
            revert MarketLimitExceeded(borrowedMarket, marketLimit, repayAmount);
        }

        _approveForLiquidation(repayAsset, borrowedMarket, repayAmount);

        uint256 errorCode =
            CErc20Interface(borrowedMarket).liquidateBorrow(borrower, repayAmount, CTokenInterface(collateralMarket));
        if (errorCode != 0) revert LiquidationCallFailed(errorCode);

        emit LiquidationExecuted(msg.sender, borrowedMarket, borrower, collateralMarket, repayAsset, repayAmount);
    }

    /// @notice Sweeps any ERC20 balance held by the wrapper to an owner-selected destination.
    function sweepAsset(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (asset == address(0)) revert InvalidAsset();
        require(to != address(0), "to=0");

        IERC20(asset).safeTransfer(to, amount);
        emit AssetSwept(asset, to, amount);
    }

    /// @notice Pauses treasury funding and liquidation execution.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses treasury funding and liquidation execution.
    function unpause() external onlyOwner {
        _unpause();
    }

    function _approveForLiquidation(address asset, address spender, uint256 amount) internal {
        IERC20 token = IERC20(asset);
        token.safeApprove(spender, 0);
        token.safeApprove(spender, amount);
    }
}
