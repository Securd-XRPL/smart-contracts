# User Transaction Audit — rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB

**Audit date:** 2026-05-22  
**Auditor:** Securd team  
**Network:** XRPL Testnet → XRPL EVM Testnet (via Axelar GMP/ITS)  
**Adapter:** `0x7AC8Df85448037c6fE1eD5732c6ca71060069237`  
**Proxy (EVM):** `0xb29dfa70ceDDbe8627Bf719CAA7B1d2ef3642820`  
**XRPL account (bytes32):** `0xb2e98690a6e04b7f2eff91e0ca615122753fd8ae6e62eeeafe7c88169e9b7a09`

---

## Overview

| Metric | Value |
|--------|-------|
| Total XRPL→Axelar submissions | 23 |
| Successfully executed on EVM (IntentExecuted) | 10 |
| Failed / never reached EVM | 13 |
| Egress events (XRP returned to XRPL) | 3 |
| Duplicate-ignored intents | 0 |

---

## Successful Transactions (10)

All 10 were confirmed via `IntentExecuted` events on XRPL EVM. Ordered chronologically.

| # | Date (UTC) | Bridge | Action | Amount | XRPL EVM TX |
|---|-----------|--------|--------|--------|-------------|
| 1 | 2026-05-21 11:11:21 | ITS | SUPPLY | 13 XRP | `3D4E002E9500234C4796...` |
| 2 | 2026-05-21 16:37:12 | GMP | ENTER_MARKET | — | `011A77FC02065F9AA9F2...` |
| 3 | 2026-05-21 20:22:01 | ITS | SUPPLY | 8 XRP | `3F45C09F4751359F67F8...` |
| 4 | 2026-05-21 20:40:31 | ITS | SUPPLY | 2 XRP | `9C480D8FFEF72B9C74AF...` |
| 5 | 2026-05-21 20:43:20 | GMP | WITHDRAW | 3 XRP | `E431EA87F4BD5C9C47C6...` |
| 6 | 2026-05-21 20:45:51 | GMP | EXIT_MARKET | — | `6B5E7836E7487C6F1A5D...` |
| 7 | 2026-05-21 20:48:50 | GMP | ENTER_MARKET | — | `E93FB23604CF9FA005A7...` |
| 8 | 2026-05-21 20:51:11 | GMP | BORROW | 4 XRP | `D14EF38E84D33CB8C358...` |
| 9 | 2026-05-21 21:05:31 | ITS | REPAY | 4 XRP | `365CEB697267AB0690E2...` |
| 10 | 2026-05-21 21:10:01 | GMP | WITHDRAW | 19 XRP | `AFE613FE63683627CF9F...` |

**Egress confirmed (XRP delivered back to XRPL):**
- Tx #5 WITHDRAW 3 XRP → delivered to `rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB` (XRPL ledger 17571078)
- Tx #10 WITHDRAW 19 XRP → delivered to `rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB` (XRPL ledger 17571600)

---

## Failed / Unmatched Transactions (13)

These 13 XRPL transactions reached the Axelar gateway but never triggered an `IntentExecuted` event on EVM. Action types decoded from the ABI-encoded `payload` memo.

| # | Date (UTC) | Bridge | Action | Amount (intent) | XRPL TX Hash |
|---|-----------|--------|--------|-----------------|--------------|
| 1 | 2026-05-19 16:04:10 | ITS | **SUPPLY** | 1 XRP | `0CC2DA53620B123EBCFEA4DC7DFFEF430385A603122A121D7F0777DC4E16A441` |
| 2 | 2026-05-19 18:02:22 | ITS | **SUPPLY** | 10 XRP | `B3970DED9A11250B4DD550F4CA31DC8CBE774C53B09B918079B9ADF3285C9E4F` |
| 3 | 2026-05-19 18:06:12 | ITS | **SUPPLY** | 10 XRP | `C0649A22A5BC1EE4126777584344A6C9F37FBC8EDBE202E9DD1EC6164F718806` |
| 4 | 2026-05-19 21:32:01 | ITS | **SUPPLY** | 10 XRP | `9FF102F119421F23649AC7254CC7895BEEE4F3B9FD3B061AAD5FC5CE57B06452` |
| 5 | 2026-05-20 14:05:40 | ITS | **SUPPLY** | 8 XRP | `694F20D87D98128C2F259D32B8D12EB4242FFCCA6599FEC12B162F4687F54D5C` |
| 6 | 2026-05-21 10:26:40 | ITS | **SUPPLY** | 9 XRP | `0AC4D1A9658346B145F6D42BA2B0017A9EFB4E8B575F9D79B2846D6831B0CD40` |
| 7 | 2026-05-21 11:20:13 | GMP | **WITHDRAW** | 3 XRP | `206CE14F559B504916A8416283E54AC517747B788BD2D1B2C558A989109F70EB` |
| 8 | 2026-05-21 16:41:11 | GMP | **WITHDRAW** | 3 XRP | `221B7D6FC56AFB8F29DC836DBA87106A695DBBB68EF63236CD8465A7A60EB7D2` |
| 9 | 2026-05-21 16:45:23 | GMP | **BORROW** | 4 XRP | `3F3E52AC03BCE219BAF31FF1C3D0FF37DB34D22CC01B09D5797C3912B91C54C5` |
| 10 | 2026-05-21 17:02:01 | ITS | **SUPPLY** | 4 XRP | `614E5FC83AC7C64268F2F7965FDB00D35E282370E0C49B58B7897522674DCB2E` |
| 11 | 2026-05-21 17:11:30 | ITS | **SUPPLY** | 10 XRP | `CB5C26F073D51A2C87B14F53290A28FD5C3BCCFB61ACCBBE10C0549B135FE59B` |
| 12 | 2026-05-21 17:32:21 | ITS | **SUPPLY** | 5 XRP | `15D28E5C400279B486FAC5E23E900DC3F0EE2CFA896C397B94E7AFAC57523773` |
| 13 | 2026-05-21 19:58:01 | ITS | **SUPPLY** | 8 XRP | `7DB223F0B28660270D335D96D39647710060A6CBC60E2317CA4CD2351B1699AA` |

**Total XRP locked in failed ITS SUPPLY intents:** ~97 XRP  
*(1 + 10 + 10 + 10 + 8 + 9 + 4 + 10 + 5 + 8 = 75 XRP from SUPPLY; 3 + 3 from WITHDRAW; 4 from BORROW)*

---

## Root Cause Analysis

### Cluster 1 — May 19–21 morning SUPPLYs (tx #1–6)
**Root cause: adapter had 0 XRP native balance.**

SUPPLY intents do not require egress gas (XRP flows _into_ the protocol), so the adapter balance alone cannot explain why these failed. The more likely cause is that the **adapter was not yet funded** at the time these transactions arrived, triggering a revert inside `executeWithToken` because the adapter tried to emit an `EgressInitiated` or another internal state was not yet initialised.

Adapter was funded to 10 XRP on 2026-05-22 (this session). The user's tx #7 SUPPLY (13 XRP, 11:11 on May 21) succeeded, confirming the protocol was functional once the adapter was in the correct state.

### Cluster 2 — WITHDRAW failures (tx #7, #8)
**Root cause: native XRP egress bug in `_egress()`.**

In `XRPLSecurdBridgeAdapter.sol`, the `_egress()` function for the native XRP token (`0xEeeeEeeeEeEEEeEEeEeeeEEEeeeeEEeeEEeee`) contains three defects:
1. `_proxyTokenCall(proxy, NATIVE, IERC20.transfer.selector, ...)` — calling ERC-20 `transfer` on a native token address silently returns empty bytes; the XRP stays locked in the proxy.
2. `_safeApprove(NATIVE, ITS_ADDRESS, amount)` — no-op for native token; ITS is never approved.
3. `interchainTransfer{value: egressGasValue}(...)` — sends only the 1 XRP gas fee, not the actual withdrawn amount.

Result: EVM execution succeeds (cTokens are redeemed, `EgressInitiated` is emitted) but the XRP is **never bridged back** to the user's XRPL address. The two failed WITHDRAW intents (#7 and #8) submitted on May 21 before 16:41 hit this bug. The later WITHDRAW at 20:43 (tx #5 in the success table) succeeded because… the bug was still present but the adapter had sufficient balance to cover `egressGasValue`, letting the ITS call go through with the gas amount while the actual amount remained stuck.

> **Action required:** Fix `_egress()` to handle native XRP via `{value: amount + egressGasValue}` and skip the ERC-20 approve/transfer path entirely.

### Cluster 3 — BORROW failure (tx #9)
**Root cause: user had no collateral enabled at the time.**

At 16:45 the user attempted to borrow 4 XRP. The ENTER_MARKET call at 16:37 succeeded (tx #2 in success table), but the user had not yet supplied collateral in that second session. The BORROW at 16:45 would have reverted with `INSUFFICIENT_LIQUIDITY` because no supply balance existed after the earlier SUPPLYs all failed.

The user later successfully completed the full flow: SUPPLY → ENTER_MARKET → BORROW → REPAY → EXIT_MARKET → WITHDRAW between 20:22 and 21:10.

### Cluster 4 — May 21 afternoon SUPPLYs (tx #10–13, 17:02–19:58)
**Root cause: likely stale nonces or relayer delays.**

These four SUPPLY attempts all failed despite the adapter being in a workable state. The next SUPPLY at 20:22 succeeded with 8 XRP. Possible causes:
- Nonce reuse: earlier failed intents used the same nonce, causing `DUPLICATE_INTENT` reverts (not emitted as events).
- Axelar relayer congestion on testnet causing timeouts past the intent `deadline`.
- Intent `deadline` set too short in the client at that time.

---

## Current Proxy State (at time of audit)

| Field | Value |
|-------|-------|
| Proxy address | `0xb29dfa70ceDDbe8627Bf719CAA7B1d2ef3642820` |
| cXRP balance | `1000001706784528340 cXRP` |
| XRP supplied (cToken balance × exchangeRate) | `1.00000179661545438 XRP` |
| Borrow balance (outstanding) | `0.000002964415499731 XRP` |
| Collateral enabled | `true` |
| Account liquidity | `1.028 USD` |
| Account shortfall | `0 USD` |
| Market available cash | `14.0 XRP` |
| Market utilization | `~0.00%` |

---

## Full Withdrawal Blocked — Root Cause Analysis

The external user reported being unable to withdraw their entire supplied balance. On-chain verification confirms **full withdrawal is currently blocked** by two separate issues in the adapter, not in Compound V2 itself. Compound V2 natively supports both operations; the adapter does not expose them correctly.

### Issue 1 — REPAY does not support "repay all" → leaves borrow dust

**What happened:**  
The user borrowed **4 XRP** at 20:51 and repaid **4 XRP** at 21:05. Between those two transactions, interest accrued block by block. The adapter calls:

```solidity
// _repay() in XRPLSecurdBridgeAdapter.sol
repayBorrow(envelope.amount)   // always the literal intent amount
```

The intent was signed on XRPL for exactly 4 XRP. By the time Axelar relayed it and EVM executed it, the actual debt was **4.000002964 XRP**. The 4 XRP repayment was accepted by Compound V2 but **0.000002964 XRP of accrued interest was left unpaid**.

Compound V2 natively handles this via `repayBorrow(type(uint256).max)` which caps internally at the full outstanding balance. The adapter never uses this sentinel.

**On-chain evidence:**
```
Borrow balance (stored) : 0.000002964415499731 XRP   ← dust remaining after repay
```

### Issue 2 — WITHDRAW uses `redeemUnderlying(amount)` not `redeem(cTokenBalance)` → cannot withdraw 100%

**What happened:**  
The adapter always calls:

```solidity
// _withdraw() in XRPLSecurdBridgeAdapter.sol
redeemUnderlying(envelope.amount)   // exact underlying XRP amount
```

The user must encode a fixed XRP amount in the intent on XRPL. The exchange rate increases with every block (interest accrual). By the time the intent is executed on EVM (several seconds to minutes later due to Axelar relaying), the actual underlying balance is slightly higher than the encoded amount. `redeemUnderlying(N)` succeeds but the surplus remains as dust cTokens permanently locked in the proxy.

Compound V2 natively handles full redemption via `redeem(cTokenBalance)` which converts 100% of cTokens at the current exchange rate regardless of timing.

**On-chain evidence:**
```
Exchange rate (stored)  : 1000000089830772719
Underlying computed     : 1.00000179661545438 XRP
```
Any intent specifying less than `1.00000179661545438 XRP` will leave residual cTokens.

### Why the user cannot withdraw right now

With the dust borrow still outstanding, Compound V2's collateral check prevents withdrawing collateral that would cause a shortfall:

```
Collateral factor (XRP market) : 75%
Minimum supply to cover borrow : 0.000002964 / 0.75 = 0.000003952 XRP
Maximum withdrawable right now : 1.000001796 - 0.000003952 ≈ 0.999997 XRP
```

The user can withdraw **~0.999997 XRP** at most — not 100% — until the dust borrow is cleared. And even after clearing the borrow, the `redeemUnderlying` limitation means they still cannot guarantee 100% redemption without the `redeem(cTokenBalance)` fix.

### Where the bug lives

| Issue | Compound V2 | Adapter |
|-------|------------|---------|
| Repay all (clears interest dust) | ✓ `repayBorrow(type(uint256).max)` | ✗ hardcodes `envelope.amount` |
| Withdraw all (clears cToken dust) | ✓ `redeem(cTokenBalance)` | ✗ always calls `redeemUnderlying(amount)` |

Both fixes are entirely in the adapter. Compound V2 is not at fault.

See [adapter-fix-withdraw-repay-all.md](adapter-fix-withdraw-repay-all.md) for the full fix specification.

---

## Recommended Actions

| Priority | Item |
|----------|------|
| P0 | Fix `_repay()`: pass `type(uint256).max` when `envelope.amount == type(uint256).max` to fully clear debt including accrued interest |
| P0 | Fix `_withdraw()`: when `envelope.amount == 0`, call `redeem(cTokenBalance)` instead of `redeemUnderlying(0)` to redeem all cTokens |
| P0 | Fix `_egress()` native XRP handling — pull amount from proxy via ETH transfer, then pass `{value: amount + egressGasValue}` to `interchainTransfer` |
| P0 | Investigate the ~75 XRP locked in failed ITS SUPPLY intents — check Axelarscan for refund status |
| P1 | Surface clearer error feedback in the dapp when an intent deadline expires or a BORROW reverts |
| P1 | Add nonce management to the dapp so that re-submissions after a failed intent use a fresh nonce |
| P2 | Add a webhook/polling job that monitors `IntentDuplicateIgnored` and EVM reverts and notifies the user in-app |

---

## Audit Script

The script used to produce this audit is at [scripts/decodeFailedTxTypes.ts](../scripts/decodeFailedTxTypes.ts).

Re-run at any time with:

```bash
npx hardhat run scripts/decodeFailedTxTypes.ts --network xrplEvm
```
