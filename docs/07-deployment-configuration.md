# Securd Deployment Configuration

## 1. Purpose

This document describes what must be configured to deploy Securd safely on XRPL EVM and connect it to the existing Axelar contracts.

## 2. Deployment principle

Securd does not deploy replacement Axelar contracts.

It integrates with:
- the existing Axelar Gateway deployment
- the existing Axelar Interchain Token Service deployment
- the existing token ids registered in the Axelar token system

## 3. Contracts to deploy

### 3.1 Core deployment set

Deploy or configure:
- `Unitroller`
- `Comptroller` implementation
- `SecurdPriceOracle`
- `JumpRateModelV2`
- `CErc20Delegator` markets for each supported asset
- `CErc20Delegate` implementation for delegated markets

### 3.2 XRPL-Axelar deployment set

Deploy:
- `XRPLUserProxyFactory(initialOwner, initialController)`
- `XRPLSecurdBridgeAdapter(initialOwner, gateway, interchainTokenService, proxyFactory, destinationChain)`

Important order:
1. deploy core components
2. deploy `XRPLUserProxyFactory`
3. deploy `XRPLSecurdBridgeAdapter`
4. set the factory controller to the adapter before any proxy exists if needed
5. list markets and trusted sources on the adapter
6. configure oracle feeds and fallback assets

## 4. Required deployment inputs

### 4.1 Axelar inputs

Required values:
- `gateway`
- `interchainTokenService`
- `destinationChain`

These are chain-specific and must come from the official Axelar deployment set for XRPL EVM.

### 4.2 Ownership inputs

Required values:
- protocol owner address
- pause operator model if different operationally
- oracle owner address if separated

### 4.3 Market inputs

For each market:
- cToken market address
- underlying ERC20 address
- Axelar token id
- listed flag
- collateral factor
- borrow cap if used
- reserve factor
- interest model address

### 4.4 Oracle inputs

For each asset:
- oracle mode: `CHAINLINK`, `BAND`, or `FALLBACK`
- Chainlink feed and heartbeat if Chainlink is used
- Band symbols and max delay if Band is used
- fallback max delay if fallback is used
- authorized bot addresses for fallback assets

## 5. Adapter post-deployment checklist

After deploying the adapter, configure:

1. trusted GMP source applications with `setTrustedGmpSource(...)`
2. trusted ITS source applications with `setTrustedItsSource(...)`
3. market registry entries with `setMarket(...)`
4. destination chain with `setDestinationChain(...)`
5. egress gas value with `setEgressGasValue(...)`
6. user intent signers with `setIntentSigner(...)`

## 6. Oracle post-deployment checklist

For each asset:

1. if Chainlink-backed:
- call `setChainlinkConfig(...)`
- call `setOracleType(asset, CHAINLINK)`

2. if Band-backed:
- call `setBandConfig(...)`
- call `setOracleType(asset, BAND)`

3. if fallback-backed:
- call `setFallbackConfig(...)`
- call `setAssetOracle(asset, bot, true)`
- call `setOracleType(asset, FALLBACK)`

## 7. XRPL Ledger LP collateral checklist

For each LP collateral asset:
- bridge representation on XRPL EVM exists as ERC20
- market is deployed and listed
- collateral factor is reviewed conservatively
- fallback oracle mode is configured
- bot authorization is limited to that asset
- freshness threshold is tight enough for risk management
- bot monitoring and alerting are live before market activation

## 8. Example configuration table template

Use a deployment sheet with columns like:
- asset symbol
- underlying address
- market address
- token id
- oracle type
- chainlink feed
- chainlink heartbeat
- band base
- band quote
- band max delay
- fallback max delay
- authorized fallback bot
- collateral factor
- reserve factor
- borrow cap

## 9. Go-live validation

Before enabling user traffic:
- test one supply on a canary account
- test one repay on a canary account
- test one borrow with egress back to XRPL Ledger
- test one withdraw with egress back to XRPL Ledger
- test duplicate intent behavior
- test bad nonce rejection
- test bad signature rejection
- test paused behavior
- test stale fallback price behavior for a fallback asset

## 10. Operational cautions

- do not allow broad trusted source configuration
- do not set markets before verifying token id mappings
- do not activate fallback-priced collateral before the bot and monitoring are live
- do not rotate the proxy factory controller after proxies exist
