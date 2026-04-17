# Securd System Architecture

## 1. Purpose

Securd is a cross-chain lending system designed around one principle:

- user intent starts on XRPL Ledger
- lending execution and state finality happen on XRPL EVM

The protocol does not try to recreate lending logic on XRPL Ledger. Instead, it keeps the risk engine and market logic on XRPL EVM and uses Axelar as the transport and settlement bridge between the two environments.

## 2. High-level architecture

The architecture has five layers.

### 2.1 XRPL Ledger user layer

This is the user-facing entry point.

Responsibilities:
- hold user assets on XRPL Ledger
- submit a `Payment` transaction or equivalent XRPL-side bridge instruction
- carry the intent metadata needed by the bridge
- identify the target market, amount, and intended destination account

This layer is not implemented in Solidity in this repository. It is the XRPL wallet, frontend, and source-side integration service that prepares the cross-chain message for Axelar.

### 2.2 XRPL source integration layer

This is the source-side bridge/orchestration layer that interprets the XRPL transaction and forwards the action to Axelar.

Responsibilities:
- receive and parse the XRPL transaction and memos
- normalize the XRPL account identifier into the `bytes32 xrplAccount` used on XRPL EVM
- build the `SignedIntent`
- route the action to the correct Axelar path
- for `SUPPLY` and `REPAY`, forward the actual tokens into Axelar ITS
- for `BORROW` and `WITHDRAW`, submit a GMP message carrying the signed control intent

This repository does not contain the XRPL-side contract or relayer implementation. The Solidity repository starts at the XRPL EVM destination.

### 2.3 Axelar transport layer

Securd uses existing Axelar deployments.

Two transport modes are used.

#### Value plane: Interchain Token Service

Used for:
- `SUPPLY`
- `REPAY`
- `BORROW` egress
- `WITHDRAW` egress

Why:
- token-bearing actions require asset movement
- XRPL EVM to XRPL Ledger return path supports token transfer only

#### Control plane: General Message Passing

Used for:
- `BORROW`
- `WITHDRAW`

Why:
- these actions do not begin with an inbound token amount on XRPL EVM
- they are instructions to unlock assets from an existing position on XRPL EVM

### 2.4 XRPL EVM integration layer

This layer is implemented in [XRPLSecurdBridgeAdapter.sol](../contracts/xrpl-axelar-integration/XRPLSecurdBridgeAdapter.sol), [XRPLUserProxyFactory.sol](../contracts/xrpl-axelar-integration/XRPLUserProxyFactory.sol), and [XRPLUserProxy.sol](../contracts/xrpl-axelar-integration/XRPLUserProxy.sol).

Responsibilities:
- verify that the call comes from the correct Axelar contract
- verify that the source chain and source application are trusted
- decode the signed intent
- verify the intent signature for the XRPL account
- enforce version, nonce, deadline, and market constraints
- prevent replay with `intentId -> payloadHash`
- resolve the deterministic user proxy
- route to the canonical market function
- initiate token egress back to XRPL Ledger when required

### 2.5 Lending core layer

This is the canonical protocol state machine and market logic.

Implemented in:
- [Unitroller.sol](../contracts/core/Unitroller.sol)
- [Comptroller.sol](../contracts/core/Comptroller.sol)
- [CToken.sol](../contracts/core/CToken.sol)
- [CErc20.sol](../contracts/core/CErc20.sol)
- [CErc20Delegator.sol](../contracts/core/CErc20Delegator.sol)
- [CErc20Delegate.sol](../contracts/core/CErc20Delegate.sol)
- [JumpRateModelV2.sol](../contracts/core/JumpRateModelV2.sol)
- [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol)

Responsibilities:
- track user collateral and borrow balances
- enforce collateral factors and liquidity checks
- accrue interest
- mint and burn market tokens
- process borrows, repayments, and withdrawals
- compute liquidation eligibility
- read prices from the configured oracle

## 3. Design boundaries

### 3.1 What Securd changes

Securd adds:
- cross-chain intent validation
- deterministic user proxy accounts
- Axelar ingress and egress handling
- XRPL Ledger-facing action routing
- expanded oracle support for Chainlink, Band, and fallback bot pricing
- support for XRPL Ledger LP collateral via fallback oracle posting

### 3.2 What Securd does not change

Securd intentionally keeps the lending engine isolated from bridge mechanics.

The bridge layer does not change:
- market accounting logic
- borrow balance math
- exchange-rate math
- collateral factor logic
- liquidation math
- utilization-based interest-rate logic

## 4. Position ownership model

Each XRPL account is mapped to one deterministic XRPL EVM proxy.

Properties:
- one proxy per XRPL account
- proxy address is deterministic with `CREATE2`
- the proxy, not the bridge adapter, is the direct owner of cTokens and borrow positions
- the bridge adapter is the only controller allowed to instruct the proxy

Why this design is important:
- positions are isolated by user
- accounting remains compatible with the lending core
- recovered state is easy to index by proxy address
- collateral and debt do not mix across users
- the bridge adapter can remain stateless with respect to balances

## 5. Intent model

The active intent schema is defined in [XRPLSecurdTypes.sol](../contracts/xrpl-axelar-integration/libraries/XRPLSecurdTypes.sol).

### 5.1 Action enum

- `SUPPLY`
- `BORROW`
- `REPAY`
- `WITHDRAW`

### 5.2 IntentEnvelope

Fields:
- `intentId`: globally unique action identifier
- `xrplAccount`: normalized XRPL account id used as the protocol identity key
- `market`: target market address on XRPL EVM
- `underlying`: underlying ERC20 asset address on XRPL EVM
- `actionType`: one of the four supported actions
- `amount`: asset amount for the action
- `nonce`: monotonically increasing nonce per `xrplAccount`
- `deadline`: latest valid execution timestamp, or `0` if no deadline is used
- `destinationAddress`: destination bytes for egress back to XRPL Ledger
- `version`: schema version

### 5.3 SignedIntent

Fields:
- `envelope`
- `signature`

The signature is verified by the bridge adapter against the configured `intentSignerOfXrplAccount[xrplAccount]`.

## 6. Transport routing

The routing table is fixed.

### 6.1 SUPPLY

Route:
- XRPL Ledger -> Axelar ITS -> XRPL EVM adapter -> user proxy -> ERC20 market

Reason:
- the user is sending principal into the protocol

### 6.2 REPAY

Route:
- XRPL Ledger -> Axelar ITS -> XRPL EVM adapter -> user proxy -> ERC20 market

Reason:
- repayment needs inbound tokens first

### 6.3 BORROW

Route:
- XRPL Ledger -> Axelar GMP -> XRPL EVM adapter -> user proxy -> ERC20 market -> ITS egress -> XRPL Ledger

Reason:
- borrow begins as a control instruction but ends with token delivery back to XRPL Ledger

### 6.4 WITHDRAW

Route:
- XRPL Ledger -> Axelar GMP -> XRPL EVM adapter -> user proxy -> ERC20 market -> ITS egress -> XRPL Ledger

Reason:
- withdraw begins as a control instruction but ends with token delivery back to XRPL Ledger

## 7. Oracle architecture

The oracle is implemented in [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol).

Each asset is assigned one oracle mode.

Modes:
- `CHAINLINK`
- `BAND`
- `FALLBACK`

### 7.1 Chainlink mode

Use when the asset has a trusted Chainlink feed on XRPL EVM.

### 7.2 Band mode

Use when Band is the preferred onchain source on XRPL EVM.

### 7.3 Fallback mode

Use when the asset has no dependable onchain feed.

This path is critical for XRPL Ledger LP collateral.

In fallback mode:
- price is stored per asset
- only an authorized oracle poster for that specific asset may update the price
- a freshness window is enforced
- stale fallback prices resolve to zero

## 8. Supported collateral model

Securd supports:
- single-asset collateral, like a standard lending market
- selected LP tokens originating from XRPL Ledger

For XRPL Ledger LP collateral:
- the bridged asset must exist as an ERC20-represented asset on XRPL EVM
- the market must be listed in the lending core
- the oracle mode should normally be `FALLBACK`
- the authorized bot posts prices onchain for that asset

## 9. Why cTokens are not sent back to XRPL Ledger

When a user supplies collateral, the market mints cTokens to the user proxy on XRPL EVM.

They remain there because:
- they are internal accounting receipts for the lending engine
- they are needed on XRPL EVM for collateral management and redemption math
- withdrawing them to XRPL Ledger would break the clean ownership model and complicate liquidation, redemption, and accounting

The user’s economically relevant position exists as:
- cToken balance in the proxy
- borrow balance in the proxy
- protocol state visible through XRPL EVM indexing and frontend APIs

## 10. Failure model

Any failed validation or market execution reverts the destination transaction.

This means:
- bad source -> revert
- bad signature -> revert
- bad nonce -> revert
- expired intent -> revert
- wrong market or wrong token -> revert
- market return code non-zero -> revert
- egress initiation failure -> revert

The protocol avoids partial success inside a single XRPL EVM transaction.
