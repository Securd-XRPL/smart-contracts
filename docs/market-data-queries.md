# Securd — Reading Market Data & User Positions

## Contract Addresses (XRPL EVM Testnet)

| Contract | Address |
|---|---|
| Comptroller (Unitroller) | `0x46d364257112230022E72b086Df85a6b0f8D3F86` |
| Oracle | `0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80` |
| XRPLSecurdBridgeAdapter | `0x7AC8Df85448037c6fE1eD5732c6ca71060069237` |
| XRPLUserProxyFactory | `0xB7f3ECe856063F48BC3bcC7A381aE875841663aA` |
| sXRP cToken | `0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318` |
| sSTST cToken | `0x2F874D87E685EC28be749B781dc99119F27CF0be` |

---

## Part 1 — Protocol-Level Market Data

### What each cToken exposes

Every cToken (sXRP, sSTST) exposes these read functions:

| Function | Returns | Notes |
|---|---|---|
| `totalSupply()` | cToken units (8 decimals) | Raw cTokens minted — needs conversion |
| `totalBorrows()` | underlying (18 decimals) | Already in underlying units |
| `getCash()` | underlying (18 decimals) | Available liquidity |
| `totalReserves()` | underlying (18 decimals) | Protocol fee reserves |
| `exchangeRateStored()` | 18-decimal mantissa | Cached rate — no state change |
| `exchangeRateCurrent()` | 18-decimal mantissa | Triggers interest accrual (non-view) |
| `supplyRatePerBlock()` | 18-decimal mantissa | Interest earned per block by suppliers |
| `borrowRatePerBlock()` | 18-decimal mantissa | Interest paid per block by borrowers |
| `decimals()` | uint8 | Always 8 for cTokens |

### Converting cTokens to underlying

`totalSupply()` returns **cToken units** (8 decimals). To get the real underlying amount:

```
totalSupplyUnderlying = totalSupply() × exchangeRate / 1e18
```

Example: 130,000,000,000 sXRP × (2e26 / 1e18) = 13 XRP

### Getting the USD price

The oracle returns prices as 18-decimal mantissas (USD per token × 1e18):

```solidity
oracle.getUnderlyingPrice(cTokenAddress)  // → e.g. 500000000000000000 = $0.50
```

Converting to USD:

```
amountUSD = amountUnderlying × price / 1e18
```

### Computing key metrics

```
Available liquidity = getCash()
Total Supplied      = totalSupply() × exchangeRate / 1e18
Total Borrowed      = totalBorrows()
Utilization rate    = totalBorrows / (getCash + totalBorrows)
Supply APY (est.)   = supplyRatePerBlock × blocksPerYear × 100
Borrow APY (est.)   = borrowRatePerBlock × blocksPerYear × 100
```

Blocks per year on XRPL EVM: **6,307,200**

### Collateral factor

```solidity
comptroller.markets(cTokenAddress)
// → (bool isListed, uint256 collateralFactorMantissa, bool isComped)
// collateralFactorMantissa / 1e18 = e.g. 0.75 = 75%
```

---

### TypeScript example — read one market

```typescript
const CTOKEN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
]
const ORACLE_ABI   = ["function getUnderlyingPrice(address cToken) view returns (uint256)"]
const COMPTROLLER_ABI = ["function markets(address) view returns (bool, uint256, bool)"]

const provider    = new ethers.JsonRpcProvider(RPC_URL)
const cToken      = new ethers.Contract(SXRP_ADDRESS, CTOKEN_ABI, provider)
const oracle      = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider)
const comptroller = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, provider)

const [totalSupplyCT, totalBorrows, cash, reserves, exchangeRate, price, supplyRate, borrowRate] =
  await Promise.all([
    cToken.totalSupply(),
    cToken.totalBorrows(),
    cToken.getCash(),
    cToken.totalReserves(),
    cToken.exchangeRateStored(),
    oracle.getUnderlyingPrice(SXRP_ADDRESS),
    cToken.supplyRatePerBlock(),
    cToken.borrowRatePerBlock(),
  ])

const BLOCKS_PER_YEAR      = 6_307_200n
const ONE                  = ethers.parseEther("1")
const totalSupplyUnderlying = (totalSupplyCT * exchangeRate) / ONE
const totalSupplyUSD        = (totalSupplyUnderlying * price) / ONE
const totalBorrowsUSD       = (totalBorrows * price) / ONE
const cashUSD               = (cash * price) / ONE
const utilization           = Number(totalBorrows * 10000n / (cash + totalBorrows)) / 100
const supplyAPY             = Number(supplyRate * BLOCKS_PER_YEAR * 100n / ONE) / 1e18
const borrowAPY             = Number(borrowRate * BLOCKS_PER_YEAR * 100n / ONE) / 1e18

console.log("Total Supply  :", ethers.formatEther(totalSupplyUnderlying), "XRP")
console.log("Total Supply  :", "$" + ethers.formatEther(totalSupplyUSD))
console.log("Total Borrows :", ethers.formatEther(totalBorrows), "XRP")
console.log("Total Borrows :", "$" + ethers.formatEther(totalBorrowsUSD))
console.log("Available     :", ethers.formatEther(cash), "XRP")
console.log("Available     :", "$" + ethers.formatEther(cashUSD))
console.log("Utilization   :", utilization.toFixed(2), "%")
console.log("Supply APY    :", supplyAPY.toFixed(4), "%")
console.log("Borrow APY    :", borrowAPY.toFixed(4), "%")
```

---

## Part 2 — Per-User Positions from an XRPL Address

### The key concept

XRPL users do not hold positions directly — their **proxy contract** on XRPL EVM holds everything. Given an XRPL address (e.g. `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48`), the steps are:

```
1. Hash the XRPL address   → xrplAccount (bytes32)
2. Look up the proxy       → proxy address on XRPL EVM
3. Query each cToken       → supplied and borrowed amounts for that proxy
```

### Step 1 — Compute the xrplAccount hash

```typescript
const xrplAddress  = "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48"
const xrplAccount  = ethers.keccak256(ethers.toUtf8Bytes(xrplAddress))
// → 0x09114758ebe00573309e1a7c06a2414665e512c25ce274e17d28c63e726a9889
```

### Step 2 — Get the proxy address

**Option A — read from factory (proxy already deployed):**

```typescript
const FACTORY_ABI = ["function proxyOf(bytes32) view returns (address)"]
const factory     = new ethers.Contract(PROXY_FACTORY_ADDRESS, FACTORY_ABI, provider)
const proxyAddr   = await factory.proxyOf(xrplAccount)
// → 0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86
// → 0x0000...0000 if proxy not yet deployed (user has never supplied)
```

**Option B — predict the address (before first supply):**

```typescript
const FACTORY_ABI = ["function predictProxy(bytes32) view returns (address)"]
const factory     = new ethers.Contract(PROXY_FACTORY_ADDRESS, FACTORY_ABI, provider)
const proxyAddr   = await factory.predictProxy(xrplAccount)
// → deterministic CREATE2 address, valid even before deployment
```

Use `predictProxy` to show a user their future proxy address in the dapp before they have ever supplied anything.

### Step 3 — Query positions on each cToken

```typescript
const CTOKEN_ABI = [
  "function balanceOfUnderlying(address account) returns (uint256)",
  "function borrowBalanceCurrent(address account) returns (uint256)",
]

// These are non-view — use staticCall to read without sending a tx
const supplied = await cToken.balanceOfUnderlying.staticCall(proxyAddr)
const borrowed = await cToken.borrowBalanceCurrent.staticCall(proxyAddr)
```

| Function | Returns | Notes |
|---|---|---|
| `balanceOfUnderlying(proxy)` | underlying (18 dec) | Supplied amount including accrued interest |
| `borrowBalanceCurrent(proxy)` | underlying (18 dec) | Borrowed amount including accrued interest |

Both functions accrue interest before returning — use `staticCall` to read without sending a transaction.

---

### Full TypeScript example — all positions for one XRPL address

```typescript
const XRPL_ADDRESS    = "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48"
const MARKETS = [
  { symbol: "XRP",  cToken: "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318" },
  { symbol: "STST", cToken: "0x2F874D87E685EC28be749B781dc99119F27CF0be" },
]

const provider   = new ethers.JsonRpcProvider(RPC_URL)
const factory    = new ethers.Contract(PROXY_FACTORY_ADDRESS,
  ["function proxyOf(bytes32) view returns (address)"], provider)
const oracle     = new ethers.Contract(ORACLE_ADDRESS,
  ["function getUnderlyingPrice(address) view returns (uint256)"], provider)

// Step 1 — hash the XRPL address
const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(XRPL_ADDRESS))

// Step 2 — get proxy
const proxyAddr = await factory.proxyOf(xrplAccount)
if (proxyAddr === ethers.ZeroAddress) {
  console.log("No proxy deployed — user has never supplied")
  return
}
console.log("Proxy:", proxyAddr)

// Step 3 — query each market
for (const { symbol, cToken: cTokenAddr } of MARKETS) {
  const cToken = new ethers.Contract(cTokenAddr,
    ["function balanceOfUnderlying(address) returns (uint256)",
     "function borrowBalanceCurrent(address) returns (uint256)"], provider)

  const [supplied, borrowed, price] = await Promise.all([
    cToken.balanceOfUnderlying.staticCall(proxyAddr),
    cToken.borrowBalanceCurrent.staticCall(proxyAddr),
    oracle.getUnderlyingPrice(cTokenAddr),
  ])

  const ONE          = ethers.parseEther("1")
  const suppliedUSD  = (supplied * price) / ONE
  const borrowedUSD  = (borrowed * price) / ONE

  console.log(`\n${symbol}`)
  console.log(`  Supplied : ${ethers.formatEther(supplied)} ${symbol}  ($${ethers.formatEther(suppliedUSD)})`)
  console.log(`  Borrowed : ${ethers.formatEther(borrowed)} ${symbol}  ($${ethers.formatEther(borrowedUSD)})`)
}
```

**Example output:**
```
Proxy: 0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86

XRP
  Supplied : 13.0 XRP  ($6.50)
  Borrowed : 1.0 XRP   ($0.50)

STST
  Supplied : 5.0 STST  ($5.00)
  Borrowed : 0.0 STST  ($0.00)
```

---

## Part 3 — All Users Across All Markets

To query all users, iterate over all deployed proxies using the factory:

```typescript
const FACTORY_ABI = [
  "function proxyCount() view returns (uint256)",
  "function proxyAtIndex(uint256) view returns (address)",   // if available
  // or iterate proxyOf per known xrplAccount
]

const count = await factory.proxyCount()
for (let i = 0; i < count; i++) {
  const proxyAddr = await factory.proxyAtIndex(i)
  // query positions as in Part 2 Step 3
}
```

Alternatively, maintain a list of known XRPL addresses in the dapp database and compute their xrplAccount hashes to look up proxies.

---

## Summary — Which function to call for what

| Data needed | Contract | Function |
|---|---|---|
| Total supplied (tokens) | cToken | `totalSupply() × exchangeRate / 1e18` |
| Total supplied (USD) | cToken + Oracle | `totalSupplyUnderlying × getUnderlyingPrice / 1e18` |
| Total borrowed (tokens) | cToken | `totalBorrows()` |
| Total borrowed (USD) | cToken + Oracle | `totalBorrows × getUnderlyingPrice / 1e18` |
| Available liquidity | cToken | `getCash()` |
| Utilization rate | cToken | `totalBorrows / (getCash + totalBorrows)` |
| Supply APY | cToken | `supplyRatePerBlock × 6307200 × 100 / 1e18` |
| Borrow APY | cToken | `borrowRatePerBlock × 6307200 × 100 / 1e18` |
| Collateral factor | Comptroller | `markets(cToken).collateralFactorMantissa / 1e18` |
| Oracle price | Oracle | `getUnderlyingPrice(cToken)` |
| User proxy address | ProxyFactory | `proxyOf(keccak256(xrplAddress))` |
| Predicted proxy (before first supply) | ProxyFactory | `predictProxy(keccak256(xrplAddress))` |
| User supplied amount | cToken | `balanceOfUnderlying.staticCall(proxyAddr)` |
| User borrowed amount | cToken | `borrowBalanceCurrent.staticCall(proxyAddr)` |
