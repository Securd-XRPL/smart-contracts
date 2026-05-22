# Securd — How to Get All Listed Markets

## Contract Addresses (XRPL EVM Testnet)

| Contract | Address |
|---|---|
| Comptroller (Unitroller) | `0x46d364257112230022E72b086Df85a6b0f8D3F86` |
| Oracle | `0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80` |

---

## The key function: `getAllMarkets()`

The Comptroller maintains an `allMarkets` array that is appended to each time `_supportMarket()`
is called by the admin. `getAllMarkets()` returns the full list of cToken addresses:

```solidity
comptroller.getAllMarkets() → CToken[]
```

This is the single source of truth — no subgraph, no off-chain index needed.

---

## Part 1 — Reading the Market List

### Minimal example

```typescript
import { ethers } from "ethers"

const provider     = new ethers.JsonRpcProvider(RPC_URL)
const comptroller  = new ethers.Contract(
  "0x46d364257112230022E72b086Df85a6b0f8D3F86",
  ["function getAllMarkets() view returns (address[])"],
  provider
)

const markets = await comptroller.getAllMarkets()
console.log("Listed markets:", markets)
// → [
//     "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",  // sXRP
//     "0x2F874D87E685EC28be749B781dc99119F27CF0be",  // sSTST
//   ]
```

---

## Part 2 — Full Market Data for Each Listed Market

For each address returned by `getAllMarkets()`, query the cToken, Comptroller, and Oracle
to get the complete market snapshot.

### ABIs needed

```typescript
const COMPTROLLER_ABI = [
  "function getAllMarkets() view returns (address[])",
  "function markets(address cToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
  "function mintGuardianPaused(address cToken) view returns (bool)",
  "function borrowGuardianPaused(address cToken) view returns (bool)",
  "function borrowCaps(address cToken) view returns (uint256)",
]

const CTOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function underlying() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function reserveFactorMantissa() view returns (uint256)",
  "function interestRateModel() view returns (address)",
  "function accrualBlockNumber() view returns (uint256)",
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

### Full TypeScript snapshot — all listed markets

```typescript
import { ethers } from "ethers"

const RPC_URL         = process.env.XRPL_EVM_RPC_URL!
const COMPTROLLER_ADDR = "0x46d364257112230022E72b086Df85a6b0f8D3F86"
const ORACLE_ADDR      = "0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80"
const BLOCKS_PER_YEAR  = 9_014_400n
const ONE              = ethers.parseEther("1")

async function main() {
  const provider    = new ethers.JsonRpcProvider(RPC_URL)
  const comptroller = new ethers.Contract(COMPTROLLER_ADDR, COMPTROLLER_ABI, provider)
  const oracle      = new ethers.Contract(ORACLE_ADDR, ORACLE_ABI, provider)

  // ── 1. Fetch market list ──────────────────────────────────────────────────
  const cTokenAddresses: string[] = await comptroller.getAllMarkets()
  console.log(`Found ${cTokenAddresses.length} listed market(s)\n`)

  // ── 2. Protocol-level params (same for all markets) ───────────────────────
  const [closeFactor, liquidationIncentive] = await Promise.all([
    comptroller.closeFactorMantissa(),
    comptroller.liquidationIncentiveMantissa(),
  ])

  // ── 3. Per-market data ────────────────────────────────────────────────────
  for (const cTokenAddr of cTokenAddresses) {
    const cToken = new ethers.Contract(cTokenAddr, CTOKEN_ABI, provider)

    const [
      symbol, totalSupplyCT, totalBorrows, cash, reserves, exchangeRate,
      supplyRate, borrowRate, reserveFactor, irmAddr, accrualBlock,
      [, collateralFactor],
      mintPaused, borrowPaused, borrowCap,
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
      comptroller.mintGuardianPaused(cTokenAddr),
      comptroller.borrowGuardianPaused(cTokenAddr),
      comptroller.borrowCaps(cTokenAddr),
      oracle.getUnderlyingPrice(cTokenAddr),
    ])

    // IRM params
    const irm = new ethers.Contract(irmAddr, IRM_ABI, provider)
    const [blocksPerYear, baseRate, multiplier, jumpMultiplier, kink] = await Promise.all([
      irm.blocksPerYear(),
      irm.baseRatePerBlock(),
      irm.multiplierPerBlock(),
      irm.jumpMultiplierPerBlock(),
      irm.kink(),
    ])

    // Derived values
    const totalSupplyUnderlying = (totalSupplyCT * exchangeRate) / ONE
    const totalSupplyUSD        = (totalSupplyUnderlying * price) / ONE
    const totalBorrowsUSD       = (totalBorrows * price) / ONE
    const cashUSD               = (cash * price) / ONE

    const denominator = cash + totalBorrows
    const utilization = denominator === 0n
      ? 0
      : Number(totalBorrows * 10000n / denominator) / 100

    const supplyAPY = Number(supplyRate * blocksPerYear * 100n) / Number(ONE) / 1e18
    const borrowAPY = Number(borrowRate * blocksPerYear * 100n) / Number(ONE) / 1e18

    console.log(`════════════════════ ${symbol} ════════════════════`)
    console.log(`cToken address        : ${cTokenAddr}`)
    console.log(`Oracle price          : $${ethers.formatEther(price)}`)
    console.log(`Accrual block         : ${accrualBlock}`)
    console.log("")
    console.log("── Market Totals ──")
    console.log(`Total supplied        : ${ethers.formatEther(totalSupplyUnderlying)} ($${ethers.formatEther(totalSupplyUSD)})`)
    console.log(`Total borrowed        : ${ethers.formatEther(totalBorrows)} ($${ethers.formatEther(totalBorrowsUSD)})`)
    console.log(`Available liquidity   : ${ethers.formatEther(cash)} ($${ethers.formatEther(cashUSD)})`)
    console.log(`Total reserves        : ${ethers.formatEther(reserves)}`)
    console.log(`Utilization           : ${utilization.toFixed(2)}%`)
    console.log("")
    console.log("── Interest Rates ──")
    console.log(`Supply APY            : ${supplyAPY.toFixed(4)}%`)
    console.log(`Borrow APY            : ${borrowAPY.toFixed(4)}%`)
    console.log(`Reserve factor        : ${(Number(ethers.formatEther(reserveFactor)) * 100).toFixed(0)}%`)
    console.log(`IRM address           : ${irmAddr}`)
    console.log(`IRM base rate APY     : ${(Number(baseRate * blocksPerYear * 100n) / Number(ONE) / 1e18).toFixed(4)}%`)
    console.log(`IRM kink              : ${(Number(ethers.formatEther(kink)) * 100).toFixed(0)}%`)
    console.log("")
    console.log("── Risk Parameters ──")
    console.log(`Collateral factor     : ${(Number(ethers.formatEther(collateralFactor)) * 100).toFixed(0)}%`)
    console.log(`Close factor          : ${(Number(ethers.formatEther(closeFactor)) * 100).toFixed(0)}%`)
    console.log(`Liquidation bonus     : ${((Number(ethers.formatEther(liquidationIncentive)) - 1) * 100).toFixed(0)}%`)
    console.log(`Borrow cap            : ${borrowCap === 0n ? "unlimited" : ethers.formatEther(borrowCap)}`)
    console.log(`Mint paused           : ${mintPaused}`)
    console.log(`Borrow paused         : ${borrowPaused}`)
    console.log("")
  }
}

main().catch(console.error)
```

---

## Part 3 — Returning as Structured Objects (for a dapp)

```typescript
interface MarketSnapshot {
  cToken:                  string
  symbol:                  string
  // totals
  totalSupplyUnderlying:   string
  totalSupplyUSD:          string
  totalBorrowsUnderlying:  string
  totalBorrowsUSD:         string
  availableLiquidity:      string
  availableLiquidityUSD:   string
  utilizationPct:          string
  priceUSD:                string
  // rates
  supplyAPY:               string
  borrowAPY:               string
  reserveFactorPct:        string
  // risk
  collateralFactorPct:     string
  closeFactorPct:          string
  liquidationBonusPct:     string
  borrowCap:               string
  mintPaused:              boolean
  borrowPaused:            boolean
  // IRM
  irmAddress:              string
  irmKinkPct:              string
  irmBaseAPY:              string
}

async function getAllMarketSnapshots(provider: ethers.Provider): Promise<MarketSnapshot[]> {
  const comptroller = new ethers.Contract(COMPTROLLER_ADDR, COMPTROLLER_ABI, provider)
  const oracle      = new ethers.Contract(ORACLE_ADDR, ORACLE_ABI, provider)

  const [cTokenAddresses, closeFactor, liquidationIncentive] = await Promise.all([
    comptroller.getAllMarkets(),
    comptroller.closeFactorMantissa(),
    comptroller.liquidationIncentiveMantissa(),
  ])

  const snapshots: MarketSnapshot[] = []

  for (const cTokenAddr of cTokenAddresses) {
    const cToken = new ethers.Contract(cTokenAddr, CTOKEN_ABI, provider)

    const [
      symbol, totalSupplyCT, totalBorrows, cash, reserves, exchangeRate,
      supplyRate, borrowRate, reserveFactor, irmAddr,
      [, collateralFactor],
      mintPaused, borrowPaused, borrowCap, price,
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
      comptroller.markets(cTokenAddr),
      comptroller.mintGuardianPaused(cTokenAddr),
      comptroller.borrowGuardianPaused(cTokenAddr),
      comptroller.borrowCaps(cTokenAddr),
      oracle.getUnderlyingPrice(cTokenAddr),
    ])

    const irm = new ethers.Contract(irmAddr, IRM_ABI, provider)
    const [blocksPerYear, baseRate, , , kink] = await Promise.all([
      irm.blocksPerYear(), irm.baseRatePerBlock(),
      irm.multiplierPerBlock(), irm.jumpMultiplierPerBlock(), irm.kink(),
    ])

    const totalSupplyUnderlying = (totalSupplyCT * exchangeRate) / ONE
    const denominator           = cash + totalBorrows
    const utilization           = denominator === 0n ? 0 : Number(totalBorrows * 10000n / denominator) / 100
    const supplyAPY             = Number(supplyRate * blocksPerYear * 100n) / Number(ONE) / 1e18
    const borrowAPY             = Number(borrowRate * blocksPerYear * 100n) / Number(ONE) / 1e18

    snapshots.push({
      cToken:                  cTokenAddr,
      symbol,
      totalSupplyUnderlying:   ethers.formatEther(totalSupplyUnderlying),
      totalSupplyUSD:          ethers.formatEther((totalSupplyUnderlying * price) / ONE),
      totalBorrowsUnderlying:  ethers.formatEther(totalBorrows),
      totalBorrowsUSD:         ethers.formatEther((totalBorrows * price) / ONE),
      availableLiquidity:      ethers.formatEther(cash),
      availableLiquidityUSD:   ethers.formatEther((cash * price) / ONE),
      utilizationPct:          utilization.toFixed(2) + "%",
      priceUSD:                ethers.formatEther(price),
      supplyAPY:               supplyAPY.toFixed(4) + "%",
      borrowAPY:               borrowAPY.toFixed(4) + "%",
      reserveFactorPct:        (Number(ethers.formatEther(reserveFactor)) * 100).toFixed(0) + "%",
      collateralFactorPct:     (Number(ethers.formatEther(collateralFactor)) * 100).toFixed(0) + "%",
      closeFactorPct:          (Number(ethers.formatEther(closeFactor)) * 100).toFixed(0) + "%",
      liquidationBonusPct:     ((Number(ethers.formatEther(liquidationIncentive)) - 1) * 100).toFixed(0) + "%",
      borrowCap:               borrowCap === 0n ? "unlimited" : ethers.formatEther(borrowCap),
      mintPaused,
      borrowPaused,
      irmAddress:              irmAddr,
      irmKinkPct:              (Number(ethers.formatEther(kink)) * 100).toFixed(0) + "%",
      irmBaseAPY:              (Number(baseRate * blocksPerYear * 100n) / Number(ONE) / 1e18).toFixed(4) + "%",
    })
  }

  return snapshots
}
```

---

## Part 4 — Quick Reference

| Data | Contract | Function |
|---|---|---|
| All listed cToken addresses | Comptroller | `getAllMarkets()` |
| Is a market listed | Comptroller | `markets(cToken).isListed` |
| Collateral factor | Comptroller | `markets(cToken).collateralFactorMantissa` |
| Mint paused | Comptroller | `mintGuardianPaused(cToken)` |
| Borrow paused | Comptroller | `borrowGuardianPaused(cToken)` |
| Borrow cap | Comptroller | `borrowCaps(cToken)` (0 = unlimited) |
| Close factor | Comptroller | `closeFactorMantissa()` |
| Liquidation bonus | Comptroller | `liquidationIncentiveMantissa() − 1e18` |
| Total supply (cToken units) | cToken | `totalSupply()` |
| Total supply (underlying) | cToken | `totalSupply() × exchangeRateStored / 1e18` |
| Total borrowed | cToken | `totalBorrows()` |
| Available liquidity | cToken | `getCash()` |
| Supply APY | cToken | `supplyRatePerBlock() × blocksPerYear × 100 / 1e18` |
| Borrow APY | cToken | `borrowRatePerBlock() × blocksPerYear × 100 / 1e18` |
| Reserve factor | cToken | `reserveFactorMantissa()` |
| IRM address | cToken | `interestRateModel()` |
| Oracle price | Oracle | `getUnderlyingPrice(cToken)` |
| IRM kink | IRM | `kink()` |
| IRM base rate | IRM | `baseRatePerBlock() × blocksPerYear` |

---

## Part 5 — Listening for New Markets (event-based)

To detect when a new market is added without polling, subscribe to the `MarketListed` event:

```typescript
const comptroller = new ethers.Contract(COMPTROLLER_ADDR,
  ["event MarketListed(address indexed cToken)"],
  provider
)

// Historical — all markets since block 0
const events = await comptroller.queryFilter(comptroller.filters.MarketListed())
const listedFromEvents = events.map(e => e.args.cToken)

// Real-time
comptroller.on("MarketListed", (cToken) => {
  console.log("New market listed:", cToken)
})
```

This gives the same list as `getAllMarkets()` but also lets you react instantly when
a new market is deployed.
