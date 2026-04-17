# XRPL LP Token Pricing And Oracle Bot

## 1. Purpose

This document explains how Securd should calculate the fair value of an XRPL Ledger AMM LP token in real time and how an offchain oracle bot should periodically publish that price to [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol).

This is the reference design for XRPL Ledger LP-token collateral.

## 2. Why the LP token price is not a normal oracle feed

For standard collateral such as XRP, USDC, USDT, BTC, or ETH, Securd can rely on onchain feeds on XRPL EVM through Chainlink or Band.

For XRPL Ledger AMM LP tokens, there is usually no direct XRPL EVM price feed.

So the protocol must derive the LP token value from:

- the current XRPL AMM pool balances
- the total LP token supply of that AMM
- the external prices of the two underlying assets

The result is then posted on XRPL EVM through the fallback oracle path.

## 3. XRPL source of truth

On XRPL Ledger, the relevant source of truth is the AMM state.

Official XRPL sources:

- `amm_info` returns:
  - the two pool balances
  - the total LP tokens outstanding
  - the AMM account
  - trading fee information
- the AMM ledger entry contains `LPTokenBalance`, which is the total outstanding LP token balance for the AMM

References:
- https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/path-and-order-book-methods/amm_info
- https://xrpl.org/docs/references/protocol/ledger-data/ledger-entry-types/amm
- https://xrpl.org/docs/concepts/tokens/decentralized-exchange/automated-market-makers
- https://xrpl.org/docs/references/protocol/transactions/types/ammwithdraw

## 4. Core valuation formula

### 4.1 Economic interpretation

For a double-asset withdrawal, XRPL AMM LP tokens represent a proportional claim on the AMM pool, and XRPL documents state that double-asset withdrawals are not charged a fee.

So the clean base valuation is:

`LP price = total pool value / total LP token supply`

Where:

- `total pool value = reserve0_value + reserve1_value`
- `reserve0_value = reserve0_amount * asset0_price`
- `reserve1_value = reserve1_amount * asset1_price`

### 4.2 Formula in normalized units

Let:

- `R0` = pool reserve of asset 0
- `R1` = pool reserve of asset 1
- `P0` = price of asset 0 in USD or protocol numeraire
- `P1` = price of asset 1 in USD or protocol numeraire
- `L` = total LP token supply outstanding

Then:

`pool_value = R0 * P0 + R1 * P1`

`lp_price = pool_value / L`

### 4.3 Why this is the right starting point

This matches the actual redeemability of LP tokens for a proportional two-asset withdrawal.

It also avoids inventing a synthetic market price for the LP token when what Securd really needs is a conservative collateral valuation.

## 5. Practical reserve inputs from XRPL

Using `amm_info`, the bot should read:

- `amm.amount`
- `amm.amount2`
- `amm.lp_token`

From these fields the bot extracts:

- reserve of asset 0
- reserve of asset 1
- total LP token supply

Important implementation detail:

- XRP amounts are represented differently from issued currency amounts on XRPL
- issued currency amounts use `{ currency, issuer, value }`
- XRP uses drops in some contexts

The bot must normalize both reserves into decimal numbers using each asset’s decimal convention before pricing.

## 6. How to price the underlying assets

The LP token itself is derived from two underlying asset prices.

### 6.1 Preferred hierarchy

For each underlying asset:

1. use XRPL EVM Chainlink price if available
2. otherwise use XRPL EVM Band price if available
3. otherwise reject LP pricing for that pool unless governance explicitly allows a fallback source

This is safer than deriving both the LP token and the underlying asset prices from weak offchain assumptions.

### 6.2 Examples

- XRP / RLUSD LP
  - use Band or Chainlink for XRP
  - use Band or Chainlink for RLUSD
- XRP / issued stablecoin LP
  - use XRP oracle
  - use stablecoin oracle if available
- exotic token / exotic token LP
  - not recommended for collateral unless both underlyings have robust pricing

## 7. Conservative collateral price policy

For collateral, the bot should not publish the raw theoretical LP price without safeguards.

Securd should use a conservative price policy such as:

`published_lp_price = raw_lp_price * (1 - haircut)`

Where the haircut depends on pool quality.

Suggested starting policy:

- highly liquid pair with both oracle-backed assets: `5%` to `10%`
- one major asset plus one weaker issued asset: `10%` to `20%`
- thin XRPL LP pool with elevated manipulation risk: `20%` to `35%`

This haircut is separate from the collateral factor.

## 8. Additional bot-side safety filters

The bot should refuse to publish a fresh price when any of the following is true.

### 8.1 Invalid AMM state

- `amm_info` fails
- reserve is zero for either side
- total LP supply is zero
- malformed currency metadata

### 8.2 Underlying price unavailable

- one of the underlying assets has no valid current price
- Chainlink/Band data for an underlying is stale beyond policy

### 8.3 Pool too small

The bot should reject pools whose total value locked is below a configured minimum.

Example:

- do not publish prices for pools with TVL below `$50,000` for production collateral

### 8.4 Pool composition too concentrated

If one side dominates the pool value too heavily, the LP can become fragile.

Example filter:

- reject if one side exceeds `95%` of total pool value

### 8.5 Sudden price move

The bot should apply a per-update circuit breaker.

Example:

- reject or require manual review if `abs(new_price - last_price) / last_price > 15%`

### 8.6 Large reserve jump

If reserves jump abnormally between observations, require confirmation across multiple validated ledgers.

## 9. Update cadence

The bot does not need to publish every ledger.

Recommended cadence:

- normal mode: every `60` to `180` seconds
- fast mode during volatility: every `15` to `30` seconds
- always refresh immediately when the price deviation threshold is exceeded

A good publish policy is:

- poll XRPL every few seconds
- compute LP price continuously
- publish on XRPL EVM only if:
  - enough time has passed since last publish, or
  - price moved more than a configured threshold

Example threshold:

- publish if `time_since_last_publish >= 120s` or `price_move >= 1%`

## 10. Freshness policy onchain

Onchain, the LP token should be configured as `FALLBACK` in [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol).

The contract already supports:

- per-asset fallback pricing
- per-asset authorized poster role
- per-asset maximum staleness

For XRPL LP collateral:

- set `oracleType = FALLBACK`
- assign the oracle bot with `setAssetOracle(asset, bot, true)`
- set a strict `fallbackMaxDelay`

Suggested starting value:

- `fallbackMaxDelay = 300` to `900` seconds

## 11. Bot architecture

### 11.1 Inputs

The bot needs:

- XRPL RPC or WebSocket endpoint
- XRPL EVM RPC endpoint
- AMM pair configuration
- mapping from LP token collateral asset on XRPL EVM to XRPL AMM pair
- underlying price source configuration
- signer key for the fallback oracle poster account

### 11.2 Processing pipeline

For each configured LP collateral asset:

1. query XRPL `amm_info`
2. normalize reserve amounts
3. fetch underlying asset prices
4. compute raw LP price
5. apply policy haircut
6. run safety checks
7. compare to last published price
8. if publish conditions pass, call `postFallbackPrice(asset, priceMantissa)` on XRPL EVM

### 11.3 Outputs

The bot should store and emit:

- observed XRPL ledger index
- AMM reserves
- underlying prices used
- raw LP price
- haircut-adjusted LP price
- publication decision
- onchain tx hash when published

## 12. Conversion to Securd oracle mantissa

[SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol) expects a `1e18` mantissa.

So if the bot computes a USD price like:

- `12.345678`

Then it must post:

- `12345678000000000000`

That means:

`priceMantissa = floor(lp_price_decimal * 1e18)`

The bot should round down, not up, for conservative collateral treatment.

## 13. Recommended implementation policy for Securd

### 13.1 Allowed LP collateral

Only allow LP collateral where:

- both underlying assets have reliable independent prices
- the pool has minimum TVL
- the pool has minimum liquidity history
- the pool is not excessively concentrated

### 13.2 Conservative governance defaults

- low collateral factor for LP collateral at launch
- strict fallback freshness window
- per-pool haircut in the bot
- per-pool borrow caps on markets using LP collateral

### 13.3 Failure mode

If the bot cannot confidently price the LP token:

- do not publish
- let the onchain price go stale
- let the protocol treat that collateral as unavailable for new borrowing once freshness expires

This is safer than publishing a weak or manipulated price.

## 14. Pseudocode

```ts
for (const pool of configuredPools) {
  const amm = await xrplClient.request({
    command: "amm_info",
    asset: pool.asset0,
    asset2: pool.asset1,
    ledger_index: "validated"
  });

  const reserve0 = normalizeAmount(amm.result.amm.amount);
  const reserve1 = normalizeAmount(amm.result.amm.amount2);
  const lpSupply = normalizeAmount(amm.result.amm.lp_token);

  if (reserve0 <= 0 || reserve1 <= 0 || lpSupply <= 0) continue;

  const price0 = await getUnderlyingPrice(pool.asset0Symbol);
  const price1 = await getUnderlyingPrice(pool.asset1Symbol);
  if (!price0.valid || !price1.valid) continue;

  const rawPrice = (reserve0 * price0.value + reserve1 * price1.value) / lpSupply;
  const adjustedPrice = rawPrice * (1 - pool.haircutBps / 10_000);

  if (!passesRiskChecks(pool, amm.result.amm, adjustedPrice)) continue;
  if (!shouldPublish(pool, adjustedPrice)) continue;

  const priceMantissa = to1e18Floor(adjustedPrice);
  await securdOracle.postFallbackPrice(pool.collateralAsset, priceMantissa);
}
```

## 15. Summary

The safest real-time price for an XRPL Ledger AMM LP token is:

- proportional claim on the current AMM reserves
- valued using independent prices for the two underlying assets
- divided by total LP token supply
- then haircut conservatively before posting onchain

That gives Securd a pricing model that is:

- economically grounded in XRPL AMM mechanics
- simple to audit
- compatible with the existing fallback oracle contract
- conservative enough for collateral use

## 16. Concrete TypeScript bot design

The recommended implementation is a small TypeScript service with the following modules:

### 16.1 `config.ts`

Responsibilities:

- load the LP-oracle pool configuration
- validate addresses, decimals, haircut bounds, and thresholds
- map each XRPL AMM pool to one XRPL EVM collateral asset

### 16.2 `xrpl.ts`

Responsibilities:

- call XRPL `amm_info`
- require `ledger_index = "validated"`
- normalize XRP drops and issued-currency string amounts
- return a canonical reserve snapshot

### 16.3 `evm.ts`

Responsibilities:

- read trusted underlying prices from XRPL EVM
- read the last published fallback price if needed
- submit `postFallbackPrice(asset, priceMantissa)` transactions
- wait for confirmation and persist tx metadata

### 16.4 `pricing.ts`

Responsibilities:

- compute raw LP NAV
- apply haircut policy
- convert the result into oracle mantissa format

### 16.5 `guards.ts`

Responsibilities:

- reject stale, malformed, low-liquidity, or high-jump pool states
- enforce minimum TVL
- enforce max concentration threshold
- enforce max allowed per-update step change

### 16.6 `publisher.ts`

Responsibilities:

- compare new computed price to the last published price
- enforce publish interval
- enforce minimum deviation before publishing
- support emergency mode for large but valid moves

### 16.7 `state.ts`

Responsibilities:

- persist the last published value, timestamp, and ledger metadata
- persist failed observations for later review
- support replay-safe restarts

## 17. Suggested LP oracle config file

The repo should use a dedicated config file for LP-pool pricing, for example:

- [xrpl-lp-oracle.example.json](../config/xrpl-lp-oracle.example.json)

Recommended shape:

```json
{
  "rpc": {
    "xrplRpcUrl": "https://xrplcluster.com",
    "xrplEvmRpcUrl": "https://rpc.xrplevm.org"
  },
  "wallet": {
    "publisherPrivateKeyEnv": "LP_ORACLE_PRIVATE_KEY"
  },
  "defaults": {
    "pollIntervalMs": 15000,
    "publishIntervalSec": 120,
    "minDeviationBps": 100,
    "maxPriceAgeSec": 180,
    "maxReserveJumpBps": 1500,
    "maxStepUpBps": 500,
    "maxStepDownBps": 1000
  },
  "pools": [
    {
      "name": "XRPL-USDC-XRP",
      "xrpl": {
        "asset0": {
          "currency": "XRP"
        },
        "asset1": {
          "currency": "USD",
          "issuer": "rIssuerAddress"
        }
      },
      "evm": {
        "collateralAsset": "0x0000000000000000000000000000000000000001",
        "underlyingDecimals": 18,
        "token0": "0x0000000000000000000000000000000000000010",
        "token1": "0x0000000000000000000000000000000000000020"
      },
      "risk": {
        "haircutBps": 800,
        "minTvlUsd": "500000",
        "maxTokenWeightBps": 8500
      }
    }
  ]
}
```

Validation and bot entrypoints:

- [xrplLpOracleConfig.ts](../scripts/xrplLpOracleConfig.ts)
- [validateXrplLpOracleConfig.ts](../scripts/validateXrplLpOracleConfig.ts)
- [runXrplLpOracleBot.ts](../scripts/runXrplLpOracleBot.ts)
- [xrplLpOracleQuorum.ts](../scripts/xrplLpOracleQuorum.ts)

The bot scaffold now includes:

- local state persistence for last observed and last published values
- reserve-jump protection between observations
- optional webhook-based alerting

## 18. Exact mantissa conversion rule

The offchain bot should first compute the LP price as a normal decimal USD value.
After that, it should convert the value into the oracle mantissa expected by the
lending core.

For an LP collateral asset with `underlyingDecimals`, the conversion is:

`priceMantissa = floor(lpPriceUsd * 10^(36 - underlyingDecimals))`

Examples:

- if LP collateral uses `18` decimals, publish with `1e18` precision
- if LP collateral uses `6` decimals, publish with `1e30` precision

The bot should always round down for collateral safety.

## 19. Publish decision algorithm

The bot should publish a new price only if all of the following are true:

1. XRPL AMM state is validated
2. both underlying prices are fresh
3. computed LP price passes all safety checks
4. either:
   - enough time has elapsed since last publish, or
   - the price moved more than the configured deviation threshold

Recommended initial policy:

- poll every `15` seconds
- publish every `120` seconds in normal mode
- publish early if deviation exceeds `100` bps

## 20. Decentralizing the LP oracle

The safest long-term answer is not to rely on a single hot wallet forever. The
recommended decentralization path is progressive.

### 20.1 Phase 1: single publisher with strong controls

This is acceptable for launch:

- one publisher key
- strict per-asset authorization
- strong monitoring
- conservative haircut
- low collateral factor

This keeps the system simple while the market is small.

### 20.2 Phase 2: multiple independent observers, one publisher

Run several independent observation nodes:

- each node reads XRPL AMM state independently
- each node computes the LP price independently
- each node signs an offchain price report
- a publisher only submits onchain if quorum is reached

Recommended quorum:

- `2 of 3`, or
- `3 of 5`

This is a strong intermediate design because the onchain oracle contract does not
need to change immediately.

Suggested signed report format:

- EIP-712 domain name: `Securd LP Oracle`
- fields:
  - `poolId`
  - `collateralAsset`
  - `roundId`
  - `nonce`
  - `observedAt`
  - `validUntil`
  - `priceMantissa`

Reference helper:

- [xrplLpOracleQuorum.ts](../scripts/xrplLpOracleQuorum.ts)
- [runXrplLpOracleAggregator.ts](../scripts/runXrplLpOracleAggregator.ts)
- [xrpl-lp-signed-reports.example.json](../config/xrpl-lp-signed-reports.example.json)

Operational meaning:

- `nonce` prevents replay of an older signed report set within the same rounding workflow
- `validUntil` gives a hard expiry so stale reports cannot be aggregated later

### 20.3 Phase 3: onchain reporter aggregation

Add a thin reporter contract on XRPL EVM:

- multiple authorized reporters submit prices for a round
- the contract accepts the median or trimmed-median value
- the accepted value is forwarded to `SecurdPriceOracle`

Reference implementation:

- [SecurdMedianOracleReporter.sol](../contracts/core/SecurdMedianOracleReporter.sol)

Deployment integration:

- [deploySecurdStack.ts](../scripts/deploySecurdStack.ts)
  can optionally deploy the median reporter and authorize it for fallback-priced markets
- [deployMedianOracleReporter.ts](../scripts/deployMedianOracleReporter.ts)
  deploys the median reporter independently when operators want to roll it out
  separately from the full stack

Recommended onchain rules:

- minimum reporter quorum
- round deadline
- maximum allowed reporter spread
- median or trimmed median as final aggregation function

Related tests:

- [xrplLpOracleQuorum.spec.ts](../test/unit/xrplLpOracleQuorum.spec.ts)
- [medianOracleDeployment.spec.ts](../test/integration/medianOracleDeployment.spec.ts)

### 20.4 Phase 4: bonded reporters

For deeper decentralization:

- reporters stake collateral
- repeated malicious or invalid reports are slashable
- governance can add and remove reporters

This is stronger, but adds substantial operational complexity.

## 21. Best decentralization choice for Securd

The best practical decision for Securd is:

1. launch with one publisher key
2. immediately run at least three independent observation nodes
3. require offchain quorum before publishing
4. later add an onchain median reporter contract once LP-collateral usage grows

That gives a good balance of:

- fast launch
- conservative safety
- reduced single-node failure risk
- clear path to stronger decentralization

## 22. Governance controls for decentralized reporting

Governance should be able to:

- pause the LP collateral market
- revoke a reporter or publisher
- tighten haircut policy
- reduce collateral factor
- cap or disable a specific LP market

Even with decentralized reporters, governance still needs emergency control over
high-risk collateral classes.
