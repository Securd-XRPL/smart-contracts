// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.10;

import "./CToken.sol";
import "./PriceOracle.sol";

contract UnitrollerAdminStorage {
    /**
    * @notice Administrator for this contract
    */
    address public admin;

    /**
    * @notice Pending administrator for this contract
    */
    address public pendingAdmin;

    /**
    * @notice Active brains of Unitroller
    */
    address public comptrollerImplementation;

    /**
    * @notice Pending brains of Unitroller
    */
    address public pendingComptrollerImplementation;
}

contract ComptrollerV1Storage is UnitrollerAdminStorage {

    /**
     * @notice Oracle which gives the price of any given asset
     */
    PriceOracle public oracle;

    /**
     * @notice Multiplier used to calculate the maximum repayAmount when liquidating a borrow
     */
    uint public closeFactorMantissa;

    /**
     * @notice Multiplier representing the discount on collateral that a liquidator receives
     */
    uint public liquidationIncentiveMantissa;

    /**
     * @notice Max number of assets a single account can participate in (borrow or use as collateral)
     */
    uint public maxAssets;

    /**
     * @notice Per-account mapping of "assets you are in", capped by maxAssets
     */
    mapping(address => CToken[]) public accountAssets;

    uint256[44] private __gap;
}

contract ComptrollerV2Storage is ComptrollerV1Storage {
    struct Market {
        // Whether or not this market is listed
        bool isListed;

        //  Multiplier representing the most one can borrow against their collateral in this market.
        //  For instance, 0.9 to allow borrowing 90% of collateral value.
        //  Must be between 0 and 1, and stored as a mantissa.
        uint collateralFactorMantissa;

        // Per-market mapping of "accounts in this asset"
        mapping(address => bool) accountMembership;

        // Whether or not this market participates in the legacy reward-distribution accounting.
        bool isRewarded;
    }

    /**
     * @notice Official mapping of cTokens -> Market metadata
     * @dev Used e.g. to determine if a market is supported
     */
    mapping(address => Market) public markets;


    /**
     * @notice The Pause Guardian can pause certain actions as a safety mechanism.
     *  Actions which allow users to remove their own assets cannot be paused.
     *  Liquidation / seizing / transfer can only be paused globally, not by market.
     */
    address public pauseGuardian;
    bool public _mintGuardianPaused;
    bool public _borrowGuardianPaused;
    bool public transferGuardianPaused;
    bool public seizeGuardianPaused;
    mapping(address => bool) public mintGuardianPaused;
    mapping(address => bool) public borrowGuardianPaused;

    uint256[43] private __gap;
}

contract ComptrollerV3Storage is ComptrollerV2Storage {
    struct RewardMarketState {
        // The market's last updated reward borrow/supply distribution index.
        uint224 index;

        // The block number the index was last updated at
        uint32 block;
    }

    /// @notice A list of all markets
    CToken[] public allMarkets;

    /// @notice Legacy reward distribution rate per block.
    uint public rewardRate;

    /// @notice The portion of the legacy reward rate that each market currently receives.
    mapping(address => uint) public rewardSpeeds;

    /// @notice Legacy reward supply state for each market.
    mapping(address => RewardMarketState) public rewardSupplyState;

    /// @notice Legacy reward borrow state for each market.
    mapping(address => RewardMarketState) public rewardBorrowState;

    /// @notice Legacy reward supplier index per market and supplier.
    mapping(address => mapping(address => uint)) public rewardSupplierIndex;

    /// @notice Legacy reward borrower index per market and borrower.
    mapping(address => mapping(address => uint)) public rewardBorrowerIndex;

    /// @notice Legacy reward amount accrued but not transferred to each user.
    mapping(address => uint) public rewardAccrued;

    uint256[42] private __gap;
}

contract ComptrollerV4Storage is ComptrollerV3Storage {
    // @notice The borrowCapGuardian can set borrowCaps to any number for any market. Lowering the borrow cap could disable borrowing on the given market.
    address public borrowCapGuardian;

    // @notice Borrow caps enforced by borrowAllowed for each cToken address. Defaults to zero which corresponds to unlimited borrowing.
    mapping(address => uint) public borrowCaps;

    uint256[48] private __gap;
}

contract ComptrollerV5Storage is ComptrollerV4Storage {
    /// @notice Legacy reward portion allocated to each contributor per block.
    mapping(address => uint) public rewardContributorSpeeds;

    /// @notice Last block at which contributor legacy rewards were allocated.
    mapping(address => uint) public lastContributorBlock;

    uint256[48] private __gap;
}

contract ComptrollerV6Storage is ComptrollerV5Storage {
    /// @notice The rate at which legacy rewards are distributed to the corresponding borrow market per block.
    mapping(address => uint) public rewardBorrowSpeeds;

    /// @notice The rate at which legacy rewards are distributed to the corresponding supply market per block.
    mapping(address => uint) public rewardSupplySpeeds;

    uint256[48] private __gap;
}

contract ComptrollerV7Storage is ComptrollerV6Storage {
    /// @notice Flag indicating whether the legacy reward accrual fix has been executed.
    bool public proposal65FixExecuted;

    /// @notice Accounting storage mapping account addresses to how much legacy reward they owe the protocol.
    mapping(address => uint) public rewardReceivable;
}
