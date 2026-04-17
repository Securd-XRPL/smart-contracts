# Securd Keeper Wrapper Design

## 1. Purpose

This document describes an optional onchain helper design for liquidation operations.

This is not required for Securd v1, but it can be useful if the protocol wants a more controlled liquidation execution path on XRPL EVM.

## 2. Current baseline

Current recommended baseline:
- liquidation bot operates from one or more treasury wallets
- bot calls the core market contracts directly
- treasury management remains offchain and operational

This is the simplest and safest launch model.

## 3. Why consider a keeper wrapper

A keeper wrapper may help if the team wants:
- standardized bot entrypoints
- centralized treasury usage controls
- onchain exposure limits
- better onchain accounting of liquidation activity
- easier operational key rotation

## 4. What the wrapper should do

A keeper wrapper should:
- hold approved repay assets
- allow only approved keeper addresses to trigger liquidation
- enforce per-market and per-asset limits
- call the standard `liquidateBorrow(...)` path on market contracts
- receive seized collateral
- emit clear accounting events

## 5. What the wrapper should not do

The wrapper should not:
- reimplement liquidation math
- bypass the Comptroller
- replace market logic
- become a general-purpose arbitrary execution contract

It should remain thin and policy-oriented.

## 6. Suggested responsibilities

### 6.1 Treasury custody

The wrapper may custody repay assets such as:
- USDC
- USDT
- XRP-represented ERC20 assets

### 6.2 Keeper permissions

The wrapper may maintain:
- `isKeeper[address]`
- optional keeper roles by asset or market

### 6.3 Risk limits

The wrapper may enforce:
- max repay per tx
- max repay per asset per period
- max repay per collateral market per period
- optional pause switch

### 6.4 Eventing

The wrapper should emit events such as:
- keeper added or removed
- treasury funded or withdrawn
- liquidation executed
- collateral swept or recycled

## 7. Suggested execution flow

1. keeper bot identifies liquidatable account offchain
2. keeper bot computes safe repay size offchain
3. keeper bot calls wrapper liquidation function
4. wrapper validates keeper and limits
5. wrapper approves repay asset to the borrowed market if needed
6. wrapper calls `liquidateBorrow(...)`
7. wrapper receives seized collateral
8. wrapper emits execution event
9. treasury manager later unwinds or withdraws collateral under policy

## 8. Suggested interface sketch

Example functions:
- `setKeeper(address keeper, bool allowed)`
- `setAssetLimit(address asset, uint256 limit)`
- `setMarketLimit(address market, uint256 limit)`
- `pause()` / `unpause()`
- `fund(address asset, uint256 amount)`
- `executeLiquidation(address borrowedMarket, address borrower, uint256 repayAmount, address collateralMarket)`
- `sweepAsset(address asset, address to, uint256 amount)`

## 9. Security considerations

If a wrapper is added, it should include:
- strict access control
- pausability
- no arbitrary call forwarding
- no admin path that can seize user collateral outside the normal liquidation rules
- rate or size limits to contain bot mistakes

## 10. Tradeoffs

### Pros
- cleaner treasury management
- easier keeper key rotation
- clearer onchain liquidation accounting
- safer than using a general hot wallet for everything

### Cons
- extra smart contract complexity
- extra code to audit
- another operational component that can fail

## 11. Recommendation for Securd

For v1:
- keep direct-wallet liquidation as the primary model
- do not add a wrapper unless treasury governance or permissioning needs become strong enough to justify more code

For later versions:
- add a minimal wrapper only if it meaningfully improves treasury control without replacing the core liquidation path

## 12. Design principle

If Securd adds a keeper wrapper, it should be a thin policy and treasury layer around the existing market liquidation flow, not a new liquidation engine.
