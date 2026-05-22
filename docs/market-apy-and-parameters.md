# Securd — Market APY & Full Parameter Queries

## Contract Addresses (XRPL EVM Testnet)

| Contract | Address |
|---|---|
| Comptroller (Unitroller) | `0x46d364257112230022E72b086Df85a6b0f8D3F86` |
| Oracle | `0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80` |
| InterestRateModel (shared) | `0xDd31C1db90AB0b094d73E0b4c8dae2296a7d8C0d` |
| sXRP cToken | `0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318` |
| sSTST cToken | `0x2F874D87E685EC28be749B781dc99119F27CF0be` |

After running `scripts/deployAndAssignSeparateIRMs.ts`, each market has its own IRM instance.
The deployment file records the address per market under `markets[].interestRateModel`.

---

## Part 1 — APY Calculation

### How APY is derived

APY is not stored on-chain. It is computed from per-block interest rates returned by the cToken:

```
supplyAPY = supplyRatePerBlock × blocksPerYear × 100 / 1e18
borrowAPY = borrowRatePerBlock × blocksPerYear × 100 / 1e18
```

`blocksPerYear` is hardcoded in the IRM at **9,014,400** (calibrated for ~3.5 s/block on XRPL EVM).

> **Note:** Actual measured block time on XRPL EVM testnet is ~5.71 s → ~5,526,725 blocks/year.
> The displayed APY will be ~38% higher than the effective rate until `updateJumpRateModel` is called
> to recalibrate `blocksPerYear`. This is a known discrepancy to address after deployment stabilises.

### APY functions on cToken

| Function | Returns |
|---|---|
| `supplyRatePerBlock()` | Per-block supply interest rate (18-dec mantissa) |
| `borrowRatePerBlock()` | Per-block borrow interest rate (18-dec mantissa) |

### The JumpRateModel curve

The IRM implements a two-slope model:

```
If utilization ≤ kink:
  borrowRate = baseRatePerBlock + utilization × multiplierPerBlock / 1e18

If utilization > kink:
  normalRate  = baseRatePerBlock + kink × multiplierPerBlock / 1e18
  excessUtil  = utilization - kink
  borrowRate  = normalRate + excessUtil × jumpMultiplierPerBlock / 1e18
```

Supply rate accounts for reserve factor:

```
supplyRate = borrowRate × utilization × (1 − reserveFactor) / 1e18²
```

### Example: Target curve (2% base, 10% slope, 109% jump, 80% kink)

| Utilization | Borrow APY | Supply APY (10% reserve) |
|---|---|---|
| 0% | 2.00% | 0.00% |
| 50% | 7.00% | 3.15% |
| 80% | 10.00% | 7.20% |
| 90% | 20.90% | 16.90% |
| 100% | 31.80% | 28.62% |

---

## Part 2 — Interest Rate Model Parameters

### Reading IRM parameters directly

```typescript
const IRM_ABI = [
  "function owner() view returns (address)",
  "function blocksPerYear() view returns (uint256)",
  "function baseRatePerBlock() view returns (uint256)",
  "function multiplierPerBlock() view returns (uint256)",
  "function jumpMultiplierPerBlock() view returns (uint256)",
  "function kink() view returns (uint256)",
  "function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) view returns (uint256)",
  "function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactor) view returns (uint256)",
  "function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) view returns (uint256)",
]

const irm = new ethers.Contract(IRM_ADDRESS, IRM_ABI, provider)

const [blocksPerYear, baseRate, multiplier, jumpMultiplier, kink] = await Promise.all([
  irm.blocksPerYear(),
  irm.baseRatePerBlock(),
  irm.multiplierPerBlock(),
  irm.jumpMultiplierPerBlock(),
  irm.kink(),
])

// Convert per-block rates back to per-year (informational)
const ONE = ethers.parseEther("1")
const baseRatePerYear       = baseRate * blocksPerYear
const multiplierPerYear     = multiplier * blocksPerYear * kink / ONE
const jumpMultiplierPerYear = jumpMultiplier * blocksPerYear

console.log("Base rate APY       :", ethers.formatEther(baseRatePerYear * 100n), "%")
console.log("Multiplier/year     :", ethers.formatEther(multiplierPerYear * 100n), "%")
console.log("Jump multiplier/year:", ethers.formatEther(jumpMultiplierPerYear * 100n), "%")
console.log("Kink                :", ethers.formatEther(kink), "(e.g. 0.8 = 80%)")
```

### Reading the IRM address from a cToken

Each cToken exposes which IRM it uses:

```typescript
const CTOKEN_ABI = ["function interestRateModel() view returns (address)"]
const cToken = new ethers.Contract(SXRP_ADDRESS, CTOKEN_ABI, provider)
const irmAddress = await cToken.interestRateModel()
// → 0xDd31C1db90AB0b094d73E0b4c8dae2296a7d8C0d  (same for both markets)
```

---

## Part 3 — Collateral Factor & Liquidation Parameters

### Collateral factor (per market)

The **collateral factor** defines what fraction of supplied value counts as collateral for borrowing.
It is set per-market in the Comptroller:

```
maxBorrowableUSD = suppliedUSD × collateralFactor
```

Example: 100 USD supplied with CF = 75% → can borrow up to 75 USD.

```typescript
const COMPTROLLER_ABI = [
  "function markets(address cToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
]

const comptroller = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, provider)

const [isListed, collateralFactorMantissa, isComped] = await comptroller.markets(CTOKEN_ADDRESS)
const collateralFactor = Number(ethers.formatEther(collateralFactorMantissa))
// e.g. 0.75 = 75%
```

### Liquidation threshold

Compound V2 (and Securd) use the **collateral factor as the liquidation threshold** — there is no
separate liquidation-threshold value. A position becomes liquidatable as soon as:

```
totalBorrowedUSD > totalCollateralUSD × collateralFactor
```

The **close factor** caps how much of a borrower's debt a liquidator can repay in one call:

```typescript
const closeFactor = await comptroller.closeFactorMantissa()
// e.g. 500000000000000000 = 50% — liquidator can repay up to 50% of debt per call
```

The **liquidation incentive** is the bonus a liquidator receives (paid in collateral):

```typescript
const liquidationIncentive = await comptroller.liquidationIncentiveMantissa()
// e.g. 1080000000000000000 = 1.08 → liquidator gets 8% bonus on seized collateral
```

### Reserve factor (per cToken)

The reserve factor determines what fraction of accrued borrow interest is kept as protocol reserves
(does not go to suppliers):

```typescript
const CTOKEN_ABI = ["function reserveFactorMantissa() view returns (uint256)"]
const cToken = new ethers.Contract(CTOKEN_ADDRESS, CTOKEN_ABI, provider)
const reserveFactor = await cToken.reserveFactorMantissa()
// e.g. 100000000000000000 = 10%
```

---

## Part 4 — Full Market Snapshot (All Parameters)

### Complete ABI for one market

```typescript
const CTOKEN_ABI = [
  // market data
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  // interest
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function reserveFactorMantissa() view returns (uint256)",
  "function interestRateModel() view returns (address)",
  "function accrualBlockNumber() view returns (uint256)",
]

const COMPTROLLER_ABI = [
  "function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
]

const ORACLE_ABI = [
  "function getUnderlyingPrice(address cToken) view returns (uint256)",
]

const IRM_ABI = [
  "function blocksPerYear() view returns (uint256)",
  "function baseRatePerBlock() view returns (uint256)",
  "function multiplierPerBlock() view returns (uint256)",
  "function jumpMultiplierPerBlock() view returns (uint256)",
  "function kink() view returns (uint256)",
]
```

### Full TypeScript snapshot — one market

```typescript
async function getMarketSnapshot(
  provider: ethers.Provider,
  cTokenAddr: string,
  comptrollerAddr: string,
  oracleAddr: string,
) {
  const cToken      = new ethers.Contract(cTokenAddr, CTOKEN_ABI, provider)
  const comptroller = new ethers.Contract(comptrollerAddr, COMPTROLLER_ABI, provider)
  const oracle      = new ethers.Contract(oracleAddr, ORACLE_ABI, provider)

  const [
    symbol, totalSupplyCT, totalBorrows, cash, reserves, exchangeRate,
    supplyRate, borrowRate, reserveFactor, irmAddr, accrualBlock,
    [, collateralFactor], closeFactor, liquidationIncentive,
    price,
  ] = await Promise.all([
    cToken.symbol(),
    cToken.totalSupply(),
    cToken.totalBorrows(),
    cToken.getCash(),
    cToken.totalReserves(),
    cToken.exchangeRateStored(),
    cToken.supplyRatePerBlock(),
    cToken.borrowRatePerBlock(),
    cToken.reserveFactorMantissa(),
    cToken.interestRateModel(),
    cToken.accrualBlockNumber(),
    comptroller.markets(cTokenAddr),
    comptroller.closeFactorMantissa(),
    comptroller.liquidationIncentiveMantissa(),
    oracle.getUnderlyingPrice(cTokenAddr),
  ])

  const irm = new ethers.Contract(irmAddr, IRM_ABI, provider)
  const [blocksPerYear, baseRate, multiplier, jumpMultiplier, kink] = await Promise.all([
    irm.blocksPerYear(),
    irm.baseRatePerBlock(),
    irm.multiplierPerBlock(),
    irm.jumpMultiplierPerBlock(),
    irm.kink(),
  ])

  const ONE = ethers.parseEther("1")
  const totalSupplyUnderlying = (totalSupplyCT * exchangeRate) / ONE
  const totalSupplyUSD        = (totalSupplyUnderlying * price) / ONE
  const totalBorrowsUSD       = (totalBorrows * price) / ONE
  const cashUSD               = (cash * price) / ONE

  const denominator = cash + totalBorrows
  const utilization = denominator === 0n
    ? 0
    : Number(totalBorrows * 10000n / denominator) / 100

  // Multiply by PRECISION before BigInt division to preserve decimal places,
  // then divide back in JS. Avoids double-division that collapses result to 0.
  const PRECISION = 1_000_000n
  const supplyAPY = Number(supplyRate * blocksPerYear * 100n * PRECISION / ONE) / Number(PRECISION)
  const borrowAPY = Number(borrowRate * blocksPerYear * 100n * PRECISION / ONE) / Number(PRECISION)

  return {
    symbol,
    // Market totals
    totalSupplyUnderlying: ethers.formatEther(totalSupplyUnderlying),
    totalSupplyUSD:        ethers.formatEther(totalSupplyUSD),
    totalBorrowsUnderlying: ethers.formatEther(totalBorrows),
    totalBorrowsUSD:        ethers.formatEther(totalBorrowsUSD),
    availableLiquidityUnderlying: ethers.formatEther(cash),
    availableLiquidityUSD: ethers.formatEther(cashUSD),
    totalReservesUnderlying: ethers.formatEther(reserves),
    utilizationPct: utilization.toFixed(2) + "%",
    priceUSD: ethers.formatEther(price),
    exchangeRate: ethers.formatEther(exchangeRate),
    accrualBlock: accrualBlock.toString(),
    // APY
    supplyAPY: supplyAPY.toFixed(4) + "%",
    borrowAPY: borrowAPY.toFixed(4) + "%",
    // Risk parameters
    collateralFactor: (Number(ethers.formatEther(collateralFactor)) * 100).toFixed(0) + "%",
    liquidationThreshold: (Number(ethers.formatEther(collateralFactor)) * 100).toFixed(0) + "% (same as CF)",
    closeFactor: (Number(ethers.formatEther(closeFactor)) * 100).toFixed(0) + "%",
    liquidationBonus: ((Number(ethers.formatEther(liquidationIncentive)) - 1) * 100).toFixed(0) + "%",
    reserveFactor: (Number(ethers.formatEther(reserveFactor)) * 100).toFixed(0) + "%",
    // IRM
    irmAddress: irmAddr,
    irmBlocksPerYear: blocksPerYear.toString(),
    baseRateAPY: (Number(baseRate * blocksPerYear * 100n * 1_000_000n / ONE) / 1_000_000).toFixed(4) + "%",
    kink: (Number(ethers.formatEther(kink)) * 100).toFixed(0) + "%",
  }
}
```

### Full TypeScript snapshot — all markets

```typescript
import { ethers } from "ethers"

const RPC_URL            = process.env.XRPL_EVM_RPC_URL!
const COMPTROLLER        = "0x46d364257112230022E72b086Df85a6b0f8D3F86"
const ORACLE             = "0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80"

const MARKETS = [
  { symbol: "XRP",  cToken: "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318" },
  { symbol: "STST", cToken: "0x2F874D87E685EC28be749B781dc99119F27CF0be" },
]

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL)

  for (const { symbol, cToken } of MARKETS) {
    const snap = await getMarketSnapshot(provider, cToken, COMPTROLLER, ORACLE)
    console.log(`\n====== ${symbol} ======`)
    console.log("Total Supply        :", snap.totalSupplyUnderlying, symbol, `($${snap.totalSupplyUSD})`)
    console.log("Total Borrows       :", snap.totalBorrowsUnderlying, symbol, `($${snap.totalBorrowsUSD})`)
    console.log("Available           :", snap.availableLiquidityUnderlying, symbol, `($${snap.availableLiquidityUSD})`)
    console.log("Utilization         :", snap.utilizationPct)
    console.log("Oracle price        : $" + snap.priceUSD)
    console.log("Supply APY          :", snap.supplyAPY)
    console.log("Borrow APY          :", snap.borrowAPY)
    console.log("Collateral factor   :", snap.collateralFactor)
    console.log("Liquidation threshold:", snap.liquidationThreshold)
    console.log("Close factor        :", snap.closeFactor)
    console.log("Liquidation bonus   :", snap.liquidationBonus)
    console.log("Reserve factor      :", snap.reserveFactor)
    console.log("IRM base rate APY   :", snap.baseRateAPY)
    console.log("IRM kink            :", snap.kink)
    console.log("IRM blocks/year     :", snap.irmBlocksPerYear)
  }
}

main().catch(console.error)
```

---

## Part 5 — Quick Reference Table

| Data | Contract | Function | Notes |
|---|---|---|---|
| Supply APY | cToken | `supplyRatePerBlock() × blocksPerYear × 100 / 1e18` | Use IRM's `blocksPerYear` |
| Borrow APY | cToken | `borrowRatePerBlock() × blocksPerYear × 100 / 1e18` | Use IRM's `blocksPerYear` |
| Total supplied (underlying) | cToken | `totalSupply() × exchangeRateStored / 1e18` | cToken has 8 decimals |
| Total borrowed | cToken | `totalBorrows()` | 18 decimals |
| Available liquidity | cToken | `getCash()` | 18 decimals |
| Utilization | cToken | `totalBorrows / (getCash + totalBorrows)` | — |
| Reserve factor | cToken | `reserveFactorMantissa()` | e.g. 1e17 = 10% |
| Oracle price (USD) | Oracle | `getUnderlyingPrice(cToken)` | 18-dec, USD per token |
| Collateral factor | Comptroller | `markets(cToken).collateralFactorMantissa / 1e18` | Also = liquidation threshold |
| Liquidation threshold | Comptroller | Same as collateral factor | No separate threshold in Compound V2 |
| Close factor | Comptroller | `closeFactorMantissa()` | Max % of debt repayable per liquidation |
| Liquidation bonus | Comptroller | `liquidationIncentiveMantissa() − 1e18` | e.g. 8% bonus |
| IRM address | cToken | `interestRateModel()` | Both markets share one IRM |
| IRM base rate | IRM | `baseRatePerBlock() × blocksPerYear` | Annual rate |
| IRM kink | IRM | `kink()` | Utilization threshold for jump |
| IRM multiplier | IRM | `multiplierPerBlock() × blocksPerYear × kink / 1e18` | Normal-zone slope |
| IRM jump multiplier | IRM | `jumpMultiplierPerBlock() × blocksPerYear` | Above-kink slope |
| Blocks per year | IRM | `blocksPerYear()` | Hardcoded in IRM (9,014,400) |

---

## Part 6 — Updating Interest Rate Parameters (Admin Only)

The IRM owner (`0x243CD17C18052dD49B803dB5be3c2907DA6ff783`) can change the curve at any time.
One call updates both sXRP and sSTST since they share the same IRM:

```typescript
const irm = new ethers.Contract(IRM_ADDRESS,
  ["function updateJumpRateModel(uint256 base, uint256 multiplier, uint256 jump, uint256 kink_) external"],
  signer)

await irm.updateJumpRateModel(
  20_000_000_000_000_000n,    // baseRatePerYear   = 2%
  100_000_000_000_000_000n,   // multiplierPerYear = 10%
  1_090_000_000_000_000_000n, // jumpMultiplier    = 109%
  800_000_000_000_000_000n,   // kink              = 80%
)
```

See `scripts/updateJumpRateModel.ts` for the full script that reads before/after state for both markets.
