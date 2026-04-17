# Securd Liquidation Bot Specification

## 1. Purpose

This document defines a concrete specification for the Securd liquidation bot.

It turns the liquidation strategy into an implementable offchain service design.

## 2. Bot objective

The liquidation bot must:
- monitor account health on XRPL EVM
- detect liquidatable accounts fast
- choose safe repay sizes
- submit liquidations using pre-funded treasury capital
- avoid unsafe liquidation when oracle confidence or exit confidence is weak

## 3. Inputs

The bot should ingest the following inputs.

### 3.1 Onchain state inputs

From XRPL EVM:
- market list
- collateral factors
- close factor
- liquidation incentive
- borrow caps
- account liquidity state
- borrow balances
- cToken balances
- exchange rates
- oracle prices
- fallback oracle timestamps where applicable

Relevant sources include:
- [Comptroller.sol](../contracts/core/Comptroller.sol)
- [CToken.sol](../contracts/core/CToken.sol)
- [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol)

### 3.2 Treasury inputs

From treasury management:
- repay asset balances per liquidator wallet
- max exposure per collateral class
- max exposure per market
- internal haircut per collateral type
- minimum expected profit threshold

### 3.3 Market liquidity inputs

From approved offchain sources:
- estimated executable exit price for seized collateral
- available unwind depth
- slippage estimates
- LP unwind constraints if collateral is LP-based

## 4. Core services

The liquidation bot should be separated into services.

### 4.1 Account scanner

Responsibilities:
- scan protocol accounts
- identify accounts near or below liquidation threshold
- prioritize candidates by risk and liquidation value

### 4.2 Risk evaluator

Responsibilities:
- verify oracle freshness
- apply internal haircuts
- compute safe repay size
- estimate expected seized value
- reject unprofitable or unsafe candidates

### 4.3 Transaction executor

Responsibilities:
- build liquidation tx
- submit through the correct liquidator wallet
- track nonce and gas policy
- confirm finality and result

### 4.4 Treasury reporter

Responsibilities:
- update available treasury balances
- update post-liquidation inventory
- produce realized PnL snapshots

## 5. Health calculation policy

The bot should not rely only on raw user-interface health metrics.

It should compute or verify:
- borrower account shortfall from Comptroller-compatible logic
- asset-level collateral concentration
- fallback-price freshness
- liquidation-path-specific exit assumptions

For fallback-priced collateral, internal health should be more conservative than onchain health.

## 6. Candidate ranking

When many accounts are liquidatable, rank candidates by:
- size of shortfall
- risk of worsening before next cycle
- profitability after haircut
- availability of repay asset in treasury
- expected ability to exit seized collateral

A practical priority score can weight:
- urgency
- expected profit
- treasury efficiency
- confidence in collateral realization

## 7. Repay sizing formula

The bot should compute:
- protocol max repay allowed by close factor
- treasury max repay available
- market-liquidity-adjusted max repay
- collateral-risk-adjusted max repay

Then choose:
- `repaySize = min(protocolMax, treasuryMax, liquidityMax, collateralRiskMax)`

## 8. Profitability calculation

For each candidate, estimate:
- `repayValue`
- `seizedOracleValue`
- `internalHaircut`
- `estimatedExitSlippage`
- `gasCost`
- `operationalBuffer`

A simple adjusted profitability model is:
- `adjustedSeizedValue = seizedOracleValue x (1 - internalHaircut) - estimatedExitSlippage`
- `netValue = adjustedSeizedValue - repayValue - gasCost - operationalBuffer`

The bot should liquidate only if:
- `netValue > minimumProfitThreshold`

## 9. Oracle safety policy

### 9.1 Chainlink assets

Proceed only if:
- feed is configured
- feed is fresh inside heartbeat
- price is non-zero

### 9.2 Band assets

Proceed only if:
- symbols are configured
- Band reference is configured
- data is fresh inside max delay
- price is non-zero

### 9.3 Fallback assets

Proceed only if:
- asset is explicitly supported by liquidation policy
- fallback price is fresh
- the external pricing methodology service is healthy
- internal haircut policy is applied

## 10. LP collateral policy

For XRPL Ledger LP collateral, the bot must apply additional checks:
- price freshness stricter than standard assets
- minimum unwind depth threshold
- higher internal haircut
- lower maximum treasury concentration
- optional manual approval mode for very large positions

## 11. Gas and submission policy

The bot should:
- use a bounded gas escalation policy
- avoid duplicate concurrent liquidation submissions for the same account
- mark candidates as in-flight while tx is pending
- release the lock only after success or confirmed failure

## 12. Reorg and retry policy

The bot should treat liquidation execution as complete only after final confirmation on XRPL EVM.

Retry policy:
- if tx fails before state change, candidate may be retried
- if account health changes and liquidation is no longer valid, drop candidate
- if treasury balance changes, recompute repay size before retry

## 13. Logging requirements

For every attempt, log:
- timestamp
- borrower proxy
- borrowed market
- collateral market
- repay asset
- repay amount
- expected seized value
- applied haircut
- gas estimate
- tx hash
- execution result
- realized post-exit PnL if known

## 14. Bot configuration file

Recommended config fields:
- rpc endpoints
- liquidator wallet ids
- market allowlist
- asset haircuts
- oracle freshness thresholds
- minimum profit threshold
- max per-asset treasury use
- max per-market treasury use
- max liquidation size per tx
- alert webhooks

## 15. Failure modes

The bot must fail closed when:
- oracle freshness cannot be verified
- treasury state cannot be verified
- price methodology service is unavailable for fallback assets
- transaction construction is inconsistent
- expected profit cannot be computed reliably

## 16. Recommended launch mode

At launch:
- use conservative thresholds
- support only the largest borrow assets first
- require fallback LP collateral to pass stricter profitability thresholds
- alert on every liquidation until volume justifies lower-touch monitoring
