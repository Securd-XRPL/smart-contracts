# Securd Contract Reference

## 1. Overview

This document describes every active contract used by Securd.

The codebase is organized into two groups:
- lending core in `contracts/core`
- XRPL-Axelar integration in `contracts/xrpl-axelar-integration`

## 2. XRPL-Axelar integration contracts

### 2.1 XRPLSecurdBridgeAdapter

File:
- [XRPLSecurdBridgeAdapter.sol](../contracts/xrpl-axelar-integration/XRPLSecurdBridgeAdapter.sol)

Role:
- destination-side application entry point for Axelar messages and token callbacks

Main responsibilities:
- maintain trusted source allowlists for GMP and ITS
- validate `SignedIntent` payloads
- enforce intent versioning, deadline, nonce, and replay constraints
- maintain the market registry `marketConfigOf`
- create or resolve the deterministic proxy for the XRPL account
- execute `mint`, `repayBorrow`, `borrow`, and `redeemUnderlying` through the proxy
- initiate ITS egress for `BORROW` and `WITHDRAW`
- provide pause and owner controls for emergency response

Key storage:
- `trustedGmpSource`
- `trustedItsSource`
- `payloadHashByIntent`
- `nextNonceByXrplAccount`
- `intentSignerOfXrplAccount`
- `marketConfigOf`
- `destinationChain`
- `egressGasValue`

Main external functions:
- `setTrustedGmpSource(...)`
- `setTrustedItsSource(...)`
- `setMarket(...)`
- `setDestinationChain(...)`
- `setEgressGasValue(...)`
- `setIntentSigner(...)`
- `pause()` / `unpause()`
- `execute(...)` for GMP control messages
- `executeWithInterchainToken(...)` for ITS token callbacks

Why it is safe by design:
- only deployed Axelar contracts can enter the adapter
- source application must also be allowlisted
- payload must carry a valid per-user signature
- nonce sequencing is enforced per XRPL account
- replay is blocked by `intentId -> payloadHash`
- market and token pair must match the configured registry

### 2.2 XRPLUserProxyFactory

File:
- [XRPLUserProxyFactory.sol](../contracts/xrpl-axelar-integration/XRPLUserProxyFactory.sol)

Role:
- deploy one execution wallet per XRPL account using `CREATE2`

Main responsibilities:
- map `bytes32 xrplAccount` to proxy address
- deterministically deploy new proxies on first use
- expose `predictProxy(...)` for indexing and frontend precomputation
- freeze controller rotation after the first proxy deployment

Important behavior:
- `setController(...)` is only allowed before any proxy exists
- once one proxy has been deployed, the factory controller is frozen

This design avoids a dangerous state where old proxies point to an old controller and become unusable after a controller rotation.

### 2.3 XRPLUserProxy

File:
- [XRPLUserProxy.sol](../contracts/xrpl-axelar-integration/XRPLUserProxy.sol)

Role:
- hold each user’s market position on XRPL EVM

Main responsibilities:
- receive tokens from the adapter
- execute arbitrary calls as directed by the adapter
- hold cToken balances and borrow positions
- allow the adapter to sweep ERC20 balances when needed for egress

Security properties:
- only the configured controller may call `execute(...)`
- failed low-level calls bubble back through `CallFailed`
- token sweeping validates ERC20 transfer success

## 3. Intent schema contract

### 3.1 XRPLSecurdTypes

File:
- [XRPLSecurdTypes.sol](../contracts/xrpl-axelar-integration/libraries/XRPLSecurdTypes.sol)

Role:
- define the canonical action and payload types

Contents:
- `ActionType`
- `IntentEnvelope`
- `SignedIntent`

This file is the schema boundary between the XRPL-side integration and the XRPL EVM bridge adapter.

## 4. Lending core contracts

### 4.1 Unitroller

File:
- [Unitroller.sol](../contracts/core/Unitroller.sol)

Role:
- admin-controlled upgradeable proxy shell for the risk engine implementation

Responsibilities:
- store admin slots and implementation slots
- forward calls to the current implementation
- manage pending and accepted implementation changes

### 4.2 Comptroller

File:
- [Comptroller.sol](../contracts/core/Comptroller.sol)

Role:
- central risk manager of the protocol

Responsibilities:
- list markets
- define collateral factors
- enforce market participation rules
- check borrow, redeem, transfer, and liquidation permissions
- manage pause controls
- manage borrow caps
- integrate the oracle
- track disabled legacy reward accounting state

What the bridge adapter relies on indirectly:
- liquidity checks during borrow and redeem paths
- oracle reads for collateral valuation
- market listing and collateral factor enforcement

### 4.3 ComptrollerStorage and ComptrollerInterface

Files:
- [ComptrollerStorage.sol](../contracts/core/ComptrollerStorage.sol)
- [ComptrollerInterface.sol](../contracts/core/ComptrollerInterface.sol)

Role:
- storage layout and permission interface for the risk engine

Why they matter:
- market contracts use `ComptrollerInterface`
- storage order must remain stable across implementations

### 4.4 CToken

File:
- [CToken.sol](../contracts/core/CToken.sol)

Role:
- shared base for interest-bearing market tokens

Responsibilities:
- accrue interest
- track account token balances
- track borrow snapshots
- handle redeem, borrow, repay, seize, and liquidation bookkeeping
- coordinate with the Comptroller for permission checks

### 4.5 CErc20

File:
- [CErc20.sol](../contracts/core/CErc20.sol)

Role:
- ERC20-backed market implementation

Responsibilities:
- `mint(...)`
- `redeem(...)`
- `redeemUnderlying(...)`
- `borrow(...)`
- `repayBorrow(...)`
- `repayBorrowBehalf(...)`
- `liquidateBorrow(...)`
- transfer underlying in and out of the market

This is the market implementation that the bridge adapter actually calls through `CErc20Interface` selectors.

### 4.6 CErc20Delegator and CErc20Delegate

Files:
- [CErc20Delegator.sol](../contracts/core/CErc20Delegator.sol)
- [CErc20Delegate.sol](../contracts/core/CErc20Delegate.sol)

Role:
- proxy/delegate pattern for markets

Why they matter:
- they allow market implementations to evolve while preserving market addresses and storage
- the bridge adapter is agnostic to whether a market is direct or delegated because it only uses the external market interface

### 4.7 CTokenInterfaces

File:
- [CTokenInterfaces.sol](../contracts/core/CTokenInterfaces.sol)

Role:
- canonical user/admin interfaces for market contracts

Important detail:
- the bridge adapter now imports `CErc20Interface` from this file instead of maintaining a duplicated local interface

### 4.8 SecurdPriceOracle

File:
- [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol)

Role:
- price adapter used by the Comptroller

Responsibilities:
- map cTokens to underlying assets
- assign one oracle mode per asset
- read Chainlink feeds
- read Band feeds
- accept authorized per-asset fallback price submissions
- enforce staleness windows

Why it matters for XRPL Ledger LP collateral:
- LP tokens that do not have a reliable native onchain feed can still be listed if the fallback bot path is used and operationally maintained

### 4.9 PriceOracle

File:
- [PriceOracle.sol](../contracts/core/PriceOracle.sol)

Role:
- minimal oracle interface expected by the Comptroller

### 4.10 JumpRateModelV2 and BaseJumpRateModelV2

Files:
- [JumpRateModelV2.sol](../contracts/core/JumpRateModelV2.sol)
- [BaseJumpRateModelV2.sol](../contracts/core/BaseJumpRateModelV2.sol)
- [InterestRateModel.sol](../contracts/core/InterestRateModel.sol)

Role:
- utilization-based interest-rate model

Responsibilities:
- define borrow rate as a function of utilization
- define a kinked jump model for high utilization
- indirectly determine supply rate through market accounting

## 5. Support files used by the core

Files:
- [ErrorReporter.sol](../contracts/core/ErrorReporter.sol)
- [ExponentialNoError.sol](../contracts/core/ExponentialNoError.sol)
- [SafeMath.sol](../contracts/core/SafeMath.sol)
- [EIP20Interface.sol](../contracts/core/EIP20Interface.sol)
- [EIP20NonStandardInterface.sol](../contracts/core/EIP20NonStandardInterface.sol)

These files provide shared arithmetic, error handling, and ERC20 interaction utilities for the market implementation.

## 6. Contract interaction map

### 6.1 Supply and repay

1. XRPL source integration forwards token-bearing intent through Axelar ITS.
2. Adapter validates the callback.
3. Adapter resolves the user proxy.
4. Adapter transfers underlying to the proxy.
5. Proxy approves the market.
6. Proxy calls the market.
7. Market calls into the Comptroller for permissioning.
8. Market updates balances and returns success.

### 6.2 Borrow and withdraw

1. XRPL source integration forwards control intent through Axelar GMP.
2. Adapter validates the message.
3. Adapter resolves the user proxy.
4. Proxy calls the market.
5. Market calls into the Comptroller for liquidity and collateral checks.
6. Market transfers underlying to the proxy.
7. Adapter pulls underlying out of the proxy.
8. Adapter uses ITS to send the underlying back to XRPL Ledger.
