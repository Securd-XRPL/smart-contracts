# Securd Liquidation Strategy

## 1. Purpose

This document explains how Securd should handle liquidation safely in practice.

The key principle is simple:
- liquidation is executed on XRPL EVM
- liquidation requires capital in advance
- that capital should be managed as a dedicated liquidation treasury

## 2. Why liquidation needs budget

A liquidator must repay part of an unhealthy borrower’s debt before it can seize collateral.

That means the liquidator needs the borrowed asset on XRPL EVM at execution time.

Example:
- a user proxy has become undercollateralized
- the user owes `10,000 USDC`
- the liquidator repays `5,000 USDC`
- the liquidator then receives discounted collateral according to the liquidation incentive

The liquidator cannot perform this action without already controlling the `5,000 USDC` on XRPL EVM.

So liquidation is not just logic. It is logic plus inventory.

## 3. Recommended model for Securd

For Securd v1, the safest operating model is:
- protocol-owned liquidation treasury
- protocol-operated liquidation bots
- liquidation execution directly on XRPL EVM

This is preferable to relying immediately on external liquidators because:
- Securd uses cross-chain user origination
- some collateral may be XRPL Ledger LP collateral using fallback pricing
- fast and reliable liquidation response is more important than early decentralization of the keeper set

## 4. Liquidation architecture

### 4.1 Components

The liquidation stack should contain:
- one or more pre-funded liquidator wallets on XRPL EVM
- one liquidation bot service
- one risk-monitoring service
- one treasury management process

### 4.2 Responsibilities

#### Liquidator wallet

Holds repay assets on XRPL EVM, such as:
- USDC
- USDT
- XRP-represented ERC20 assets
- any other major borrow assets supported by the protocol

#### Liquidation bot

Monitors protocol health and sends liquidation transactions.

Tasks:
- watch account liquidity
- identify liquidatable accounts
- compute safe repay amount
- submit liquidation transactions
- record the realized seized collateral

#### Risk monitor

Validates whether liquidation should proceed.

Checks:
- oracle freshness
- collateral price confidence
- market liquidity for seized collateral
- maximum allowed exposure to a single collateral type

#### Treasury manager

Recycles profits and replenishes inventory.

Tasks:
- rebalance borrow-asset inventory
- sell or unwind seized collateral
- replenish the repay wallet
- enforce risk limits per asset

## 5. Why liquidation should stay on XRPL EVM

Securd should not route liquidation through XRPL Ledger.

Reasons:
- liquidation is latency-sensitive
- collateral and debt state are on XRPL EVM
- oracle prices are read on XRPL EVM
- the Comptroller and market math live on XRPL EVM
- adding cross-chain delay increases bad debt risk

The safest path is:
- monitor on XRPL EVM
- liquidate on XRPL EVM
- manage inventory on XRPL EVM
- only bridge funds later if needed

## 6. Liquidation treasury design

## 6.1 What the treasury should hold

The treasury should primarily hold the assets users borrow, not every possible collateral asset.

Why:
- liquidation repays debt assets
- collateral is what the liquidator receives afterward

So inventory planning should focus first on:
- the largest borrow assets
- the most concentrated borrow markets
- the assets needed most often for repay operations

## 6.2 Minimum viable treasury

At launch, treasury should cover:
- at least the most likely partial liquidation sizes in the top borrow markets
- enough working capital to handle multiple unhealthy accounts in stressed but realistic conditions

A practical launch treasury often starts with:
- inventory in the top one to three borrow assets
- conservative limits on long-tail borrow markets
- conservative collateral factors on volatile or fallback-priced collateral

## 6.3 Treasury sizing framework

A simple sizing framework is:

1. determine top borrow assets by expected usage
2. estimate the largest unhealthy account per asset class
3. apply protocol close factor
4. estimate how many simultaneous liquidations must be handled in a short stress window
5. add operational buffer

### 6.3.1 Formula intuition

For one borrow asset:
- required budget is approximately:
- `largest expected liquidatable debt x close factor x simultaneous event multiplier x safety buffer`

Illustrative example:
- largest expected unhealthy `USDC` debt = `40,000`
- close factor = `50%`
- simultaneous event multiplier = `2`
- safety buffer = `1.25`

Then a reasonable first budget is:
- `40,000 x 0.5 x 2 x 1.25 = 50,000 USDC`

This is not exact math, but it is a good operational starting point.

## 6.4 Dynamic treasury scaling

As TVL grows, treasury should scale with:
- borrow concentration
- market volatility
- percentage of fallback-priced collateral
- concentration of LP-token collateral

Treasury should not be static.

## 7. Liquidation execution policy

## 7.1 Basic execution path

1. bot detects an unhealthy account on XRPL EVM
2. bot confirms oracle and market conditions are safe enough
3. bot chooses repay amount within close factor and treasury limits
4. bot repays debt using treasury inventory
5. bot receives seized collateral
6. treasury manager later unwinds or holds seized collateral based on policy

## 7.2 Repay amount policy

The bot should not always liquidate the maximum possible amount.

It should choose the minimum of:
- protocol close-factor limit
- available treasury balance for the repay asset
- asset-specific risk cap
- market liquidity-adjusted max size

This avoids overcommitting the treasury into a hard-to-exit collateral position.

## 7.3 Seized collateral handling policy

After liquidation, seized collateral should go through one of these paths:

1. hold temporarily on XRPL EVM if the asset is liquid and risk is acceptable
2. redeem or unwind if it is a cToken or market position that should be converted
3. sell or hedge through approved venues if market liquidity exists
4. quarantine if the collateral is operationally risky or price confidence is weak

## 8. Special policy for XRPL Ledger LP collateral

This is the most sensitive category.

XRPL Ledger LP collateral can be valuable for the protocol product, but it must be handled conservatively because:
- it may rely on fallback oracle pricing
- liquidation exit liquidity may be weaker than spot assets
- mark-to-market confidence may be lower than Chainlink-backed assets

## 8.1 Recommended controls

For LP collateral markets:
- lower collateral factors than standard single-asset collateral
- tighter borrow caps
- strict oracle freshness windows
- separate treasury exposure caps
- separate liquidation haircuts in internal risk analysis

## 8.2 Treasury rule for LP collateral

The treasury should assume that LP collateral may take time to realize.

That means:
- do not size treasury assuming immediate full exit at oracle value
- assume liquidation value is lower than posted oracle value in stressed conditions
- apply internal discounts before deciding whether a liquidation is economically safe

## 8.3 Recommended internal haircut policy

For fallback-priced LP collateral, the bot should internally discount oracle value before acting.

Example:
- onchain oracle value says seized collateral value = `10,000`
- internal bot haircut = `20%`
- bot treats realizable value as `8,000`

This protects the treasury from theoretical but unrealizable profits.

## 9. Bot decision policy

The bot should only liquidate when all required checks pass.

## 9.1 Required checks before liquidation

- account is actually liquidatable according to XRPL EVM state
- oracle inputs are fresh enough
- repay asset balance is available in treasury
- expected liquidation is profitable after fees and internal haircut
- seized collateral is within treasury exposure limits
- network conditions are acceptable for execution

## 9.2 Profitability model

The bot should estimate:
- repay amount
- liquidation incentive value
- gas and execution cost
- slippage or unwind cost
- internal haircut on seized collateral

Only if the adjusted expected value remains positive should the bot liquidate.

## 10. When the bot must not liquidate

This is one of the most important sections.

The bot must not liquidate when:
- fallback oracle price is stale
- Chainlink or Band price is stale or zero
- the LP pricing methodology is temporarily broken
- destination market state looks inconsistent
- the repay asset balance is insufficient
- the expected profit after haircut is negative or too small
- the seized collateral would exceed treasury concentration limits
- there is reason to believe the collateral cannot be exited safely

For LP collateral, this rule should be especially strict.

## 11. Emergency policy for stressed markets

If fallback-priced collateral becomes operationally unreliable, Securd should prefer safety over aggressive liquidation.

Possible responses:
- pause new cross-chain user actions through the adapter
- raise monitoring severity for affected markets
- stop bot liquidation on affected collateral classes until price confidence is restored
- manually review large unhealthy accounts
- lower market risk parameters through governance or admin process if that is part of the operating model

## 12. Treasury recycling model

A good liquidation engine is not only about repaying debt. It is about restoring treasury capacity.

Treasury recycling loop:
1. treasury funds liquidation
2. treasury receives collateral
3. collateral is unwound, redeemed, sold, or rebalanced
4. treasury replenishes repay-asset inventory
5. realized profit remains as reserve or protocol revenue

Without a recycling process, liquidation capacity degrades over time.

## 13. Recommended launch policy for Securd

For launch, I recommend:
- protocol-owned liquidation treasury
- one or more internal keeper bots on XRPL EVM
- inventory only in major borrow assets at first
- conservative borrow caps on fallback-priced collateral markets
- stricter internal haircuts for XRPL Ledger LP collateral
- hard operational rule that stale LP prices disable bot liquidation for that collateral class

## 14. Example launch posture

Illustrative launch posture:
- treasury inventory in `USDC`, `USDT`, and one XRPL-native bridged ERC20 asset
- low initial caps on LP-collateral-backed borrowing
- bot liquidates only if:
  - fallback price age is below threshold
  - expected profit after haircut is positive
  - treasury concentration limits remain respected

This gives Securd a safe operational starting point while usage data is still limited.

## 15. Long-term evolution

Over time, Securd can evolve toward:
- external or partner liquidators
- auction-based unwind systems
- more advanced liquidation routing
- dynamic treasury optimization
- per-market keeper competition

But that should come after stable v1 operation, not before.

## 16. Final recommendation

The safest liquidation strategy for Securd is:
- keep liquidation local to XRPL EVM
- maintain a protocol-owned liquidation treasury in advance
- run conservative keeper bots
- treat XRPL Ledger LP collateral with stricter internal risk rules than ordinary single-asset collateral
- never let the bot rely only on theoretical oracle value when deciding liquidation profitability
