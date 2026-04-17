# Securd Treasury Sizing Worksheet

## 1. Purpose

This worksheet gives the team a practical template for sizing the initial liquidation treasury.

It is not onchain logic. It is an operational planning tool.

## 2. Goal

For each repay asset, estimate how much inventory should be held on XRPL EVM so the liquidation bot can respond safely to stressed accounts.

## 3. Inputs per borrow asset

For each borrow asset, collect:
- asset symbol
- projected top unhealthy account debt
- protocol close factor
- simultaneous event multiplier
- safety buffer
- internal collateral realization haircut environment
- target treasury size

## 4. Base formula

Suggested formula:

`treasuryTarget = largestExpectedLiquidatableDebt x closeFactor x simultaneousEventMultiplier x safetyBuffer`

Where:
- `largestExpectedLiquidatableDebt` = debt amount you expect could need urgent action
- `closeFactor` = protocol close factor from Comptroller
- `simultaneousEventMultiplier` = expected number of meaningful liquidation events in one stress window
- `safetyBuffer` = extra reserve for uncertainty

## 5. Example worksheet

| Asset | Largest unhealthy debt | Close factor | Simultaneous multiplier | Safety buffer | Suggested treasury |
| --- | ---: | ---: | ---: | ---: | ---: |
| USDC | 40,000 | 0.50 | 2.0 | 1.25 | 50,000 |
| USDT | 25,000 | 0.50 | 1.5 | 1.25 | 23,437.5 |
| XRP-ERC20 | 15,000 | 0.50 | 1.5 | 1.30 | 14,625 |

Round upward operationally.

## 6. Conservative adjustment for fallback-priced collateral

If an asset is heavily borrowed against fallback-priced LP collateral, increase the treasury target.

Ways to do this:
- increase `simultaneousEventMultiplier`
- increase `safetyBuffer`
- maintain a separate stress reserve bucket

Example:
- same asset base requirement = `50,000`
- fallback exposure surcharge = `20%`
- adjusted treasury target = `60,000`

## 7. Asset concentration overlay

If one borrow asset dominates protocol borrow demand, treasury target should be higher than the base formula suggests.

A practical overlay:
- if asset share of total borrows > 40%, add extra buffer
- if top three borrowers dominate that market, add extra concentration buffer

## 8. LP collateral exposure overlay

For markets backed by XRPL Ledger LP collateral, use an additional worksheet field:
- `lpCollateralRiskMultiplier`

Adjusted formula:

`treasuryTarget = baseTarget x lpCollateralRiskMultiplier`

Example values:
- standard single-asset collateral: `1.00`
- modest fallback LP exposure: `1.15`
- heavy fallback LP exposure: `1.25` to `1.50`

## 9. Suggested launch worksheet template

Use a table with these columns:
- asset
- projected top unhealthy account debt
- close factor
- simultaneous event multiplier
- safety buffer
- LP collateral risk multiplier
- raw treasury target
- rounded treasury target
- current treasury balance
- deficit or surplus

## 10. Recalculation cadence

Recalculate treasury targets:
- weekly in early launch
- after every major market listing
- after collateral factor changes
- after meaningful TVL growth
- after volatility events

## 11. Minimum launch checklist

Before go-live, ensure:
- treasury target exists for each major borrow asset
- actual funded balance on XRPL EVM meets or exceeds target
- treasury deficits are documented and matched by tighter risk limits
- fallback-priced collateral markets have explicit extra buffer

## 12. Policy recommendation

If treasury is below target for an asset, reduce risk before increasing user activity.

Possible actions:
- lower borrow cap
- lower collateral factor on related markets
- delay listing of additional correlated collateral
- raise operator alert thresholds
