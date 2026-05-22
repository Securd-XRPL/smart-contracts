# Securd Dapp — Design Specification

**Version:** 1.0  
**Date:** 2026-05-22  
**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Viem · HyperGate

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [User Personas & Mental Model](#3-user-personas--mental-model)
4. [Information Architecture](#4-information-architecture)
5. [Pages & Screens](#5-pages--screens)
   - 5.1 [Markets Page (home)](#51-markets-page-home)
   - 5.2 [Market Detail Page](#52-market-detail-page)
6. [Core UI Components](#6-core-ui-components)
   - 6.1 [AccountSummary](#61-accountsummary)
   - 6.2 [BorrowLimitBar](#62-borrowlimitbar)
   - 6.3 [HealthFactor](#63-healthfactor)
   - 6.4 [SupplyMarketsTable](#64-supplymarketstable)
   - 6.5 [BorrowMarketsTable](#65-borrowmarketstable)
   - 6.6 [SupplyModal](#66-supplymodal)
   - 6.7 [BorrowModal](#67-borrowmodal)
   - 6.8 [TxStatusModal](#68-txstatusmodal)
   - 6.9 [MarketStats](#69-marketstats)
   - 6.10 [UserPosition](#610-userposition)
7. [User Flows](#7-user-flows)
   - 7.1 [Supply](#71-supply)
   - 7.2 [Enable/Disable Collateral](#72-enabledisable-collateral)
   - 7.3 [Borrow](#73-borrow)
   - 7.4 [Repay](#74-repay)
   - 7.5 [Withdraw](#75-withdraw)
8. [Data Layer](#8-data-layer)
   - 8.1 [Market Data](#81-market-data)
   - 8.2 [User Account Data](#82-user-account-data)
   - 8.3 [XRPL Wallet Balance](#83-xrpl-wallet-balance)
9. [Transaction Pipeline](#9-transaction-pipeline)
   - 9.1 [Intent Envelope](#91-intent-envelope)
   - 9.2 [Signing Flow](#92-signing-flow)
   - 9.3 [Axelar Relay Status](#93-axelar-relay-status)
10. [State Management](#10-state-management)
11. [Compound V2 Business Logic](#11-compound-v2-business-logic)
12. [Error States & Edge Cases](#12-error-states--edge-cases)
13. [Missing Features & Next Steps](#13-missing-features--next-steps)

---

## 1. Product Overview

Securd is a non-custodial lending protocol that lets XRPL Ledger users **supply and borrow assets** without ever touching an EVM wallet. Users sign standard XRPL Payments from their Xumm or Gem wallet; Axelar relays those payments to a Compound V2 fork deployed on XRPL EVM.

**Core value proposition:**
- Native XRPL UX — no MetaMask, no bridge UI, no EVM gas management
- Standard lending mechanics (supply → earn, collateral → borrow)
- Non-custodial — funds sit in the user's deterministic proxy contract on XRPL EVM

**Currently live markets (XRPL EVM Testnet):**

| Symbol | Underlying | Collateral Factor |
|--------|-----------|-------------------|
| sXRP   | XRP (native) | 75% |
| sSTST  | STST (Axelar ITS IOU) | 70% |

---

## 2. Architecture Summary

```
XRPL Ledger (user's wallet)
    │  XRPL Payment + Axelar memo
    ▼
Axelar Network  →  XRPL EVM
                       │
                BridgeAdapter.sol
                (verifies intent signature, routes by ActionType)
                       │
                XRPLUserProxy.sol  (1 per XRPL address, CREATE2)
                       │
              ┌────────┴────────┐
          Comptroller       cToken markets
          (borrow limits,   (sXRP, sSTST)
           liquidation)
```

**Key identities:**
- `xrplAddress` — user's `r...` address on XRPL Ledger (what HyperGate gives us)
- `xrplAccount` — `keccak256(xrplAddress)` — on-chain identifier in the adapter
- `proxyAddress` — deterministic EVM address derived from `xrplAccount` via CREATE2 — where cToken balances live
- `sessionKey` — EVM keypair registered via `setIntentSigner(xrplAccount, evmAddr)` — signs all intent envelopes (server-side)

---

## 3. User Personas & Mental Model

### Who uses Securd

**Supplier / Yield Earner**
- Holds XRP or STST on XRPL Ledger
- Wants to earn passive yield without bridging manually
- Mental model: "I deposit my XRP and it earns interest. I can get it back any time."

**Borrower / Leveraged User**
- Has XRP collateral, wants to borrow stablecoins (STST)
- Understands liquidation risk
- Mental model: "I lock up XRP, borrow STST, use it, then repay."

### What users must understand

1. **Supply ≠ Collateral** — supplying earns yield but does NOT automatically enable borrowing against that asset. The user must explicitly enable collateral (Enter Market).
2. **Bridge delay** — transactions are not instant. Axelar relay takes 2–5 minutes. The dapp shows a live progress tracker.
3. **Health Factor** — borrowing reduces health factor. If it drops to 1.0, the position is liquidatable.
4. **Repay buffer** — when repaying in full, a +0.5% buffer is added to cover interest that accrues during the bridge relay window.

---

## 4. Information Architecture

```
/                   → redirects to /markets
/markets            → main dashboard (supply + borrow tables, account summary)
/markets/[cToken]   → market detail page (APY chart, stats, user position)
```

No auth, no onboarding flow. The wallet connection state gates data display within each page.

---

## 5. Pages & Screens

### 5.1 Markets Page (home)

**Route:** `/markets`

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  Header (logo, wallet connect)                              │
├─────────────────────────────────────────────────────────────┤
│  AccountSummary (teal hero bar)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Net APY     │  │Supply Balance│  │Borrow Balance│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  [BorrowLimitBar ──────────────────────]  [HealthFactor]    │
├─────────────────────────────────────────────────────────────┤
│  Supply Markets                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Asset │ APY │ Total Supply │ Wallet │ Supplied │ ...  │  │
│  │ XRP   │ 0.8%│ $X,XXX       │ 10 XRP │ $0       │[Sup] │  │
│  │ STST  │ 0.2%│ $X,XXX       │ 0 STST │ $0       │[Sup] │  │
│  └──────────────────────────────────────────────────────┘  │
│  Borrow Markets                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Asset │ APY │ Available │ Utilization │ Borrowed │... │  │
│  │ XRP   │ 2.0%│ $X,XXX    │ ████░░ 30%  │ $0       │[Bor]│  │
│  │ STST  │ 0.5%│ $X,XXX    │ ███░░ 20%   │ $0       │[Bor]│  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**States:**
- **Disconnected** — hero shows "Connect your wallet" CTA. Tables show market data but all user columns show "—"
- **Connected, loading** — hero shows skeleton. Tables show skeleton rows.
- **Connected, loaded** — full data shown.

---

### 5.2 Market Detail Page

**Route:** `/markets/[cToken]`

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  Header                                                     │
├─────────────────────────────────────────────────────────────┤
│  ← Back to Markets    [Asset icon]  XRP / Securd XRP        │
├─────────────────────────────────────────────────────────────┤
│  [UtilizationChart ──────────────]  [MarketStats ─────────] │
│  APY over time (Supply / Borrow)    Listed, CF, Price, etc. │
├─────────────────────────────────────────────────────────────┤
│  [UserPosition ────────────────────────────────────────────]│
│  Supplied: $0   [Collateral] [Withdraw] [Supply]            │
│  Borrowed: $0                          [Repay]  [Borrow]    │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Core UI Components

### 6.1 AccountSummary

**Location:** `components/markets/AccountSummary.tsx`  
**Rendered in:** Markets page hero (teal background)

Displays the user's protocol-wide position. Three stat cards + borrow limit bar + health factor.

| Field | Source | Description |
|-------|--------|-------------|
| Net APY | `userAccount.netAPY` | Weighted supply APY minus weighted borrow APY |
| Supply Balance | `userAccount.totalSupplyUSD` | Sum of all supplied positions in USD |
| Borrow Balance | `userAccount.totalBorrowUSD` | Sum of all outstanding borrows in USD |
| Borrow Limit | `userAccount.borrowLimitUSD` | Σ(supplyUSD × CF) across entered markets |
| Borrow Limit Used | `userAccount.borrowLimitUsed` | totalBorrowUSD / borrowLimitUSD |
| Health Factor | `userAccount.healthFactor` | borrowLimitUSD / totalBorrowUSD |

**Disconnected state:** shows "Connect your wallet" with a connect button.  
**Loading state:** skeleton placeholders.

---

### 6.2 BorrowLimitBar

**Location:** `components/markets/BorrowLimitBar.tsx`

Horizontal progress bar showing how much of the borrow limit is used.

| % Used | Bar Color |
|--------|-----------|
| 0–59%  | Green (`bg-systemGreen`) |
| 60–79% | Yellow (`bg-systemYellow`) |
| ≥ 80%  | Red (`bg-systemRed`) |

Used in: AccountSummary, SupplyModal (preview), BorrowModal (preview).

---

### 6.3 HealthFactor

**Location:** `components/markets/HealthFactor.tsx`

Displays `borrowLimitUSD / totalBorrowUSD`. Color-coded:

| Value | Label | Color |
|-------|-------|-------|
| ∞ (no borrow) | Safe | Green |
| > 1.5 | Safe | Green |
| 1.1–1.5 | Caution | Yellow |
| 1.0–1.1 | Danger | Red |
| ≤ 1.0 | Liquidatable | Red (bold) |

---

### 6.4 SupplyMarketsTable

**Location:** `components/markets/SupplyMarketsTable.tsx`

Tabular list of all markets from the supply perspective. Each row shows:

| Column | Data | Notes |
|--------|------|-------|
| Asset | icon + symbol + name | Links to market detail |
| APY | `market.supplyAPY` | Green text |
| Total Supply | `market.totalSupplyUSD` | Hidden on mobile |
| Wallet | XRPL balance of this asset | Hidden on small screens |
| Supplied | `position.supplyBalanceUSD` | "—" if no position |
| Collateral badge | `position.isCollateral` | "Collateral on/off" sub-label |
| Actions | Supply / Withdraw / Collateral buttons | Visible on row hover |

**Collateral toggle button:** calls `ENTER_MARKET` or `EXIT_MARKET` intent directly from the table row (no modal). Disabled if:
- `exitGuard.isBlocked` — would create shortfall
- `exitGuard.isChecking` — on-chain check in progress
- Intent is pending

**Opens SupplyModal** for Supply and Withdraw actions.

---

### 6.5 BorrowMarketsTable

**Location:** `components/markets/BorrowMarketsTable.tsx`

| Column | Data | Notes |
|--------|------|-------|
| Asset | icon + symbol + name | |
| APY | `market.borrowAPY` | Red text |
| Available | `market.availableLiquidityUSD` | Cash in the market |
| Utilization | `market.utilization` + mini bar | Hidden on small screens |
| Borrowed | `position.borrowBalanceUSD` | "—" if no position |
| Actions | Borrow / Repay buttons | Visible on row hover |

**Opens BorrowModal** for Borrow and Repay actions.

---

### 6.6 SupplyModal

**Location:** `components/markets/SupplyModal.tsx`

Two-tab modal: **Supply** and **Withdraw**.

**Supply tab:**
- Amount input with "Max" = XRPL wallet balance
- Impact preview rows: Supply APY, projected Borrow Limit
- BorrowLimitBar preview (updates as amount changes)
- Submit button → fires `SUPPLY` intent

**Withdraw tab:**
- Amount input with "Max" = currently supplied balance
- Calls `getHypotheticalAccountLiquidity` on-chain with 350ms debounce
- Shows projected borrow limit after withdrawal
- Blocks submission if withdrawal would cause shortfall
- Submit button → fires `WITHDRAW` intent

**Key design decisions:**
- Hypothetical liquidity check is exact (on-chain) — not an approximation
- Preview label shows "On-chain preview" vs "Projected preview" to communicate confidence
- If the on-chain check fails (RPC error), shows "Unable to preview on-chain impact" and blocks

---

### 6.7 BorrowModal

**Location:** `components/markets/BorrowModal.tsx`

Two-tab modal: **Borrow** and **Repay**.

**Borrow tab:**
- Amount input with "Max" = 80% of available borrow power (safety margin)
- Calls `getHypotheticalAccountLiquidity` on-chain for exact post-borrow liquidity
- Shows: projected borrow balance, borrow limit used %, health factor after borrow
- Warning at ≥80% utilization: "High utilization — liquidation risk"
- Blocks at 100% (shortfall)

**Repay tab:**
- Amount input with "Max" = current borrow balance + **0.5% buffer**
- The buffer covers interest accrued during the Axelar relay window (2–5 min)
- When user clicks Max, a note is shown: "+0.5% buffer included to cover interest accrued during bridge relay"
- Submit button → fires `REPAY` intent

---

### 6.8 TxStatusModal

**Location:** `components/markets/TxStatusModal.tsx`

Shown after any intent is submitted (XRPL tx hash available).

Four-step progress tracker:

```
✓  XRPL Transaction Submitted
⟳  Axelar Relay Detected           ← spinner on active step
○  Axelar Network Approved
○  Executed on XRPL EVM
```

Step states: `pending` → `done` → `error`  
Active step = first pending step where all prior steps are done.

**External links** (shown when available):
- XRPL Explorer link
- Axelarscan link  
- XRPL EVM tx link

**Terminal states:**
- All steps done → green "Transaction completed successfully."
- Any step error → red "Transaction failed on XRPL EVM. Check Axelarscan for details."

**Dismiss:** "Track in background" while pending; "Close" when terminal.

---

### 6.9 MarketStats

**Location:** `components/markets/MarketDetail/MarketStats.tsx`

Static info card for a single market:

| Row | Value |
|-----|-------|
| Total Supply | totalSupplyUSD |
| Total Borrow | totalBorrowsUSD |
| Available Liquidity | availableLiquidityUSD |
| Utilization | utilization % |
| Supply APY | supplyAPY (green) |
| Borrow APY | borrowAPY (red) |
| Collateral Factor | collateralFactor % |
| Reserve Factor | reserveFactor % |
| Price | priceUSD |

---

### 6.10 UserPosition

**Location:** `components/markets/MarketDetail/UserPosition.tsx`

Per-market position card shown on the detail page. Two panels:

**Supplied panel:**
- Balance in USD + APY + collateral status
- Actions: Collateral toggle, Withdraw, Supply

> Note: The collateral toggle on the detail page is currently disabled with tooltip "Collateral toggle coming soon — requires a direct EVM interaction not yet supported." This is because ENTER/EXIT_MARKET currently relies on the XRPL intent flow, and the detail page doesn't yet wire up the intent submission.

**Borrowed panel:**
- Borrow balance in USD + APY
- Actions: Repay, Borrow

---

## 7. User Flows

### 7.1 Supply

```
User opens SupplyModal
    │
    ├─ Enters amount
    ├─ Preview: estimated new borrow limit shown
    │
    └─ Clicks "Supply XRP"
         │
         ├─ useSubmitIntent() called with ACTION_TYPE.SUPPLY
         │    ├─ Fetch nonce from adapter (on-chain)
         │    ├─ Build IntentEnvelope
         │    ├─ POST /api/sign-intent → get ECDSA signature
         │    ├─ Build XRPL ITS Payment (amount in drops + gas drops)
         │    └─ HyperGate prompts user to sign in Xumm/Gem
         │
         └─ TxStatusModal opens with XRPL tx hash
              └─ Polls Axelarscan every ~10s until XRPL EVM execution confirmed
```

**On-chain result:** `supply()` called on the cToken via the user's proxy. User receives cTokens. Supply balance increases.

---

### 7.2 Enable/Disable Collateral

**Enable (Enter Market):**
```
User clicks "Collateral" toggle on SupplyMarketsTable row
    │
    └─ useSubmitIntent() with ACTION_TYPE.ENTER_MARKET
         ├─ Builds GMP Payment (gas drops only, no token transfer)
         └─ On execution: comptroller.enterMarkets([cToken]) via proxy
              └─ Borrow limit increases by (supplied × CF)
```

**Disable (Exit Market):**
```
User clicks "Exit" toggle
    │
    ├─ useExitMarketGuard() checks on-chain:
    │    ├─ If user has open borrow in this market → blocked: "Repay first"
    │    └─ If exiting would create shortfall → blocked: "Would create shortfall"
    │
    └─ If safe: useSubmitIntent() with ACTION_TYPE.EXIT_MARKET
         └─ On execution: comptroller.exitMarket(cToken) via proxy
              └─ Borrow limit decreases by (supplied × CF)
```

---

### 7.3 Borrow

```
User opens BorrowModal → Borrow tab
    │
    ├─ Enters amount (max = 80% of available borrow power)
    ├─ useHypotheticalLiquidity() queries getHypotheticalAccountLiquidity on-chain
    │    └─ Shows: projected borrow limit used, health factor
    │
    └─ Clicks "Borrow XRP"
         │
         ├─ useSubmitIntent() with ACTION_TYPE.BORROW
         │    ├─ GMP Payment (gas drops only)
         │    └─ On execution: cToken.borrow(amount) via proxy
         │         └─ Adapter sends borrowed tokens to user's XRPL address via ITS
         │
         └─ TxStatusModal tracks relay + EVM execution + ITS egress
```

**Adapter requirement:** adapter must hold ≥ 1 XRP native balance for egress gas. If empty, `borrow()` will fail on-chain. Use `scripts/fundAdapter.ts` to refill.

---

### 7.4 Repay

```
User opens BorrowModal → Repay tab
    │
    ├─ Enters amount (or clicks Max for full repay + 0.5% buffer)
    │
    └─ Clicks "Repay XRP"
         │
         └─ useSubmitIntent() with ACTION_TYPE.REPAY
              ├─ ITS Payment (repay tokens + gas drops)
              └─ On execution: cToken.repayBorrow(amount) via proxy
                   └─ Borrow balance decreases (or fully cleared)
```

**Max repay buffer:** the +0.5% is applied because interest accrues block-by-block. By the time the Axelar relay finalizes (~2–5 min), the actual debt is slightly higher than what was read at submission time. Without the buffer, full repayment would leave a tiny residual borrow.

---

### 7.5 Withdraw

```
User opens SupplyModal → Withdraw tab
    │
    ├─ Enters amount (max = supplied balance)
    ├─ useHypotheticalLiquidity() checks on-chain if withdrawal is safe
    │    └─ Blocked if withdrawal would create shortfall
    │         (i.e. remaining collateral < total borrows / CF)
    │
    └─ Clicks "Withdraw XRP"
         │
         └─ useSubmitIntent() with ACTION_TYPE.WITHDRAW
              ├─ GMP Payment (gas drops only)
              └─ On execution: cToken.redeem(cTokenAmount) via proxy
                   └─ Adapter sends withdrawn tokens to user's XRPL address via ITS
```

**Adapter requirement:** same as borrow — adapter needs ≥ 1 XRP for egress.

---

## 8. Data Layer

### 8.1 Market Data

**Source:** `lib/hooks/useMarketsData.ts`  
**Refresh:** every 30 seconds via `setInterval`  
**Transport:** `xrplEvmClient` (Viem public client) reads directly from XRPL EVM RPC

**Per-market reads (one `Promise.all` per market):**

| Data | Contract | Method |
|------|----------|--------|
| Total cash | cToken | `getCash()` |
| Total borrows | cToken | `totalBorrows()` |
| Total reserves | cToken | `totalReserves()` |
| Total supply (cTokens) | cToken | `totalSupply()` |
| Exchange rate | cToken | `exchangeRateStored()` |
| Borrow rate/block | cToken | `borrowRatePerBlock()` |
| Supply rate/block | cToken | `supplyRatePerBlock()` |
| Reserve factor | cToken | `reserveFactorMantissa()` |
| Collateral factor | Comptroller | `markets(cToken)` |
| Oracle price | Oracle | `getUnderlyingPrice(cToken)` |

**Computed fields:**

| Field | Formula |
|-------|---------|
| `supplyAPY` | `(supplyRatePerBlock × BLOCKS_PER_YEAR / 1e18) × 100` |
| `borrowAPY` | `(borrowRatePerBlock × BLOCKS_PER_YEAR / 1e18) × 100` |
| `utilization` | `totalBorrows / (totalCash + totalBorrows - totalReserves)` |
| `totalSupplyUSD` | `(totalSupply × exchangeRate / 1e18) × priceUSD` |
| `priceUSD` | `rawOraclePrice / 10^(36 - underlyingDecimals)` |

> **Important:** `BLOCKS_PER_YEAR` must be `9_014_400` for XRPL EVM (~3.5s blocks). Using the Ethereum value (`6_307_200` or `2_102_400`) will produce incorrect APY figures.

---

### 8.2 User Account Data

**Source:** `lib/hooks/useUserAccount.ts` → reads from `marketsStore`  
**Populated by:** `useUserData` hook (not yet fully implemented — currently uses mock/stub)

**Per-user reads (against `proxyAddress`):**

| Data | Contract | Method |
|------|----------|--------|
| cToken balance | cToken | `balanceOf(proxyAddress)` |
| Borrow balance | cToken | `borrowBalanceCurrent(proxyAddress)` |
| Collateral status | Comptroller | `checkMembership(proxyAddress, cToken)` |
| Total liquidity | Comptroller | `getAccountLiquidity(proxyAddress)` |

**Proxy address derivation:**
```typescript
proxyAddress = computeCreate2Address(
  factoryAddress,
  keccak256(xrplAccount),  // xrplAccount = keccak256(xrplAddress)
  proxyBytecodeHash
)
```

**Computed user fields:**

| Field | Formula |
|-------|---------|
| `totalSupplyUSD` | Σ `(cTokenBal × exchangeRate / 1e18) × priceUSD` |
| `totalBorrowUSD` | Σ `borrowBalance × priceUSD` |
| `borrowLimitUSD` | Σ `supplyUSD × CF` for entered markets only |
| `borrowLimitUsed` | `totalBorrowUSD / borrowLimitUSD` |
| `healthFactor` | `borrowLimitUSD / totalBorrowUSD` |
| `netAPY` | `(Σ supplyUSD×supplyAPY - Σ borrowUSD×borrowAPY) / totalSupplyUSD` |

---

### 8.3 XRPL Wallet Balance

**Source:** `lib/hooks/useXrplBalance.ts`  
**Transport:** XRPL JSON-RPC (`wss://s.altnet.rippletest.net:51233`)

For native XRP: `account_info` → `account_data.Balance` (in drops, divide by 1e6)  
For IOU tokens: `account_lines` filtered by currency + issuer

Used only for the "Wallet" column in SupplyMarketsTable and the Max button in SupplyModal.

---

## 9. Transaction Pipeline

### 9.1 Intent Envelope

Every action is encoded as an `IntentEnvelope` struct:

```typescript
type IntentEnvelope = {
  intentId:           `0x${string}`;  // random bytes32
  xrplAccount:        `0x${string}`;  // keccak256(xrplAddress)
  market:             Address;         // cToken address
  underlying:         Address;         // underlying ERC-20 (or 0xEeee... for XRP)
  actionType:         ActionType;      // 0=SUPPLY 1=BORROW 2=REPAY 3=WITHDRAW 4=ENTER 5=EXIT
  amount:             bigint;          // in wei (18 decimals), 0 for ENTER/EXIT
  nonce:              bigint;          // current adapter nonce for this xrplAccount
  deadline:           bigint;          // unix timestamp (now + 10min)
  destinationAddress: string;          // user's XRPL r-address (for BORROW/WITHDRAW egress)
  version:            number;          // always 1
}
```

### 9.2 Signing Flow

```
Client                          Server (/api/sign-intent)
  │                                    │
  ├── fetch nonce on-chain             │
  ├── build envelope                   │
  ├── POST envelope ──────────────────►│
  │                                    ├── keccak256(abi.encode(envelope)) = payloadHash
  │                                    ├── keccak256(abi.encode(adapterAddr, chainId, payloadHash)) = digest
  │                                    └── ECDSA.sign(sessionKey, digest) = signature
  │◄─── signature ─────────────────────│
  │
  ├── ABI-encode (envelope, signature) = payload
  ├── Hex-encode payload
  └── Attach as Axelar memo on XRPL Payment
```

**Session key:** an EVM keypair (`INTENT_SIGNER_PRIVATE_KEY`) held by the server, registered on-chain via `adapter.setIntentSigner(xrplAccount, sessionKeyAddr)`. The server signs on behalf of the XRPL user.

### 9.3 Axelar Relay Status

**Source:** `lib/xrpl/useAxelarStatus.ts`  
**Method:** polls Axelarscan API for the XRPL tx hash

Four steps tracked:

| Step key | Meaning |
|----------|---------|
| `xrplSubmitted` | XRPL tx confirmed on-ledger |
| `relayDetected` | Axelar relayer picked up the GMP/ITS message |
| `axelarApproved` | Axelar validators approved |
| `evmExecuted` | EVM execution confirmed |

Each step: `"pending"` → `"done"` or `"error"`

---

## 10. State Management

**Store:** Zustand (`lib/data/marketsStore`)

```typescript
type MarketsStore = {
  markets:       MarketData[];
  isLoading:     boolean;
  userAccount:   UserAccount | null;
  isUserLoading: boolean;

  setMarkets:        (m: MarketData[]) => void;
  setMarketsLoading: (v: boolean) => void;
  setUserAccount:    (u: UserAccount | null) => void;
  setUserLoading:    (v: boolean) => void;
}
```

Market data is fetched globally once (in `app/sync.tsx`) and shared across all components. User data is re-fetched whenever the connected XRPL address changes.

---

## 11. Compound V2 Business Logic

### Borrow capacity

A user can borrow up to their **borrow limit**:

```
borrowLimit = Σ [ supplyBalanceUSD_i × collateralFactor_i ]
              for all markets where isCollateral = true
```

A borrow is rejected by the Comptroller if it would push `totalBorrowUSD > borrowLimit`.

### Liquidation

If `totalBorrowUSD > borrowLimit` (health factor < 1.0), any external account can call `liquidateBorrow()`:
- Liquidator repays up to 50% of the outstanding borrow
- Liquidator receives the equivalent in cTokens plus a liquidation incentive (typically 8%)

The dapp does not expose liquidation UI — that is handled by the `LiquidationKeeper` bot (`scripts/deployLiquidationKeeper.ts`).

### Interest accrual

Interest accrues every block. The `borrowBalance` returned by `borrowBalanceCurrent()` is always up-to-date. `borrowBalanceStored()` may be slightly stale (last accrual block). The dapp uses `borrowBalanceCurrent()` for user-facing figures.

### Exchange rate

cTokens are not 1:1 with the underlying. The exchange rate grows over time as interest accrues:

```
underlyingBalance = cTokenBalance × exchangeRate / 1e18
```

For display purposes, `exchangeRateStored()` is sufficient. For precision operations (e.g. computing exact cTokens to redeem for a given underlying amount), `exchangeRateCurrent()` should be used (it accrues interest first).

---

## 12. Error States & Edge Cases

| Scenario | Current Handling | Correct Handling |
|----------|-----------------|-----------------|
| Adapter out of funds (BORROW/WITHDRAW fails on EVM) | TxStatusModal shows "failed" | Show explicit warning "Adapter low on funds — borrow/withdraw may fail" |
| XRPL wallet has no STST trustline | ITS transfer fails on XRPL side | Show "Open STST trustline" CTA before allowing borrow of STST |
| Nonce race condition | Silent double-spend | Server-side nonce lock (single in-flight intent per xrplAccount) |
| Oracle price stale | Borrow/liquidation may use stale price | Band oracle has freshness check; show warning if price > 5min old |
| Partial repay due to buffer not enough | Residual borrow remains | Offer "Repay remaining dust" flow |
| Session key not registered | `InvalidSigner` revert on EVM | Server should call `setIntentSigner` during user onboarding |
| Deadline exceeded (relay > 10min) | `DeadlineExpired` revert | Increase deadline to 30min; add retry flow in TxStatusModal |

---

## 13. Missing Features & Next Steps

### P0 — Required for production

| Feature | Status | Notes |
|---------|--------|-------|
| Real user data reads (`useUserData`) | Stub/mock | Must read `balanceOf`, `borrowBalanceCurrent`, `checkMembership` from EVM using proxyAddress |
| Session key registration flow | Manual (scripts only) | Needs onboarding: auto-call `setIntentSigner` on first user interaction |
| STST trustline check | Not implemented | Before allowing STST borrow/withdraw, verify `account_lines` for STST trustline |
| Adapter balance monitoring | `checkAdapterFunds.ts` (script) | Show in-dapp warning if adapter < 3 XRP |
| sSTST market in `MARKETS` config | Commented out | Add sSTST to `lib/constants/markets.ts` |

### P1 — Important UX

| Feature | Status | Notes |
|---------|--------|-------|
| Collateral toggle on Market Detail page | Disabled with TODO comment | Wire up `useSubmitIntent` on UserPosition component |
| Utilization chart (APY over time) | Component exists | Needs historical data source (subgraph or DB) |
| Net APY calculation | Formula in spec | Requires both supply and borrow positions loaded |
| Mobile responsive tables | Partially done | Wallet and utilization columns hidden on mobile; needs testing |
| Transaction history | Not started | Show past intents with Axelarscan links |

### P2 — Nice to have

| Feature | Notes |
|---------|-------|
| Liquidation risk notification | Push alert when health factor < 1.2 |
| Estimated earnings calculator | "If you supply X for Y days you earn Z" |
| Protocol TVL page | Aggregate stats across all markets |
| Dark/light theme toggle | Currently dark only |
