# Adapter Fix — "Repay All" and "Withdraw All" Sentinels

**Status:** Implemented (2026-07-24) — see [Implementation Notes](#implementation-notes-2026-07-24) for how the shipped fix differs from the original proposal below.  
**Affected contract:** `contracts/xrpl-axelar-integration/XRPLSecurdBridgeAdapter.sol`  
**Related audit:** [user-audit-rPpamGt.md](user-audit-rPpamGt.md)

---

## Background

Compound V2 accrues interest on every block. This creates a timing problem for cross-chain intents:

1. A user on XRPL signs an intent encoding a fixed XRP amount.
2. Axelar relays the message. By the time EVM executes it, interest has accrued and the actual balance differs from the encoded amount.
3. The adapter passes the literal intent amount to Compound V2. The call succeeds but leaves a dust residual (accrued interest for REPAY, or fractional cTokens for WITHDRAW).
4. The user can never fully exit their position.

Compound V2 already provides the right solution: sentinel values that mean "use everything":

| Intent | Compound V2 call | Sentinel |
|--------|-----------------|----------|
| Repay entire debt | `repayBorrow(type(uint256).max)` | Compound caps internally at borrow balance |
| Withdraw entire supply | `redeem(cTokenBalance)` | Redeems all cTokens at current exchange rate |

The adapter must expose these through a convention the XRPL client can signal. The chosen convention:

- **`amount = type(uint256).max`** in the intent envelope → "repay all outstanding debt"
- **`amount = 0`** in the intent envelope → "redeem all cTokens (full withdrawal)"

---

## Fix 1 — `_repay()`: Support "Repay All"

### Current code (`XRPLSecurdBridgeAdapter.sol` line ~463)

```solidity
function _repay(address proxy, address market, address underlying, uint256 amount) internal {
    _safeTransfer(underlying, proxy, amount);

    _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));
    _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, amount));

    (bool repayOk, bytes memory repayOut) =
        _proxyCallRaw(proxy, market, abi.encodeWithSelector(CErc20Interface.repayBorrow.selector, amount));

    _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));

    if (!repayOk) {
        if (repayOut.length == 0) revert ProxyCallFailed(market);
        assembly { revert(add(repayOut, 0x20), mload(repayOut)) }
    }
    _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.REPAY), repayOut);
}
```

### Problem

`repayBorrow(amount)` uses the exact intent amount. If interest accrued between signing and execution, the borrow balance is `amount + delta`. The repayment clears `amount` but leaves `delta` as dust. The user can never fully close their debt without knowing the exact borrow balance at the precise execution block — impossible from XRPL.

### Fixed code

```solidity
function _repay(address proxy, address market, address underlying, uint256 amount) internal {
    bool repayAll = (amount == type(uint256).max);

    if (repayAll) {
        // Read current borrow balance to transfer the exact amount needed from adapter to proxy.
        // type(uint256).max is passed through to repayBorrow so Compound clears the full debt
        // including any interest that accrued between intent signing and execution.
        amount = CErc20Interface(market).borrowBalanceCurrent(proxy);
    }

    _safeTransfer(underlying, proxy, amount);

    _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));
    // Approve the actual token amount, but pass type(uint256).max to repayBorrow when repayAll.
    _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, amount));

    uint256 repayArg = repayAll ? type(uint256).max : amount;
    (bool repayOk, bytes memory repayOut) =
        _proxyCallRaw(proxy, market, abi.encodeWithSelector(CErc20Interface.repayBorrow.selector, repayArg));

    _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));

    if (!repayOk) {
        if (repayOut.length == 0) revert ProxyCallFailed(market);
        assembly { revert(add(repayOut, 0x20), mload(repayOut)) }
    }
    _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.REPAY), repayOut);
}
```

### How it works

- When `envelope.amount == type(uint256).max`, the adapter calls `borrowBalanceCurrent(proxy)` to get the live borrow balance (this call also accrues interest, so it is exact at execution time).
- It transfers that exact amount from adapter to proxy, approves the market for that amount.
- It calls `repayBorrow(type(uint256).max)`: Compound V2 internally caps at the full outstanding balance, clearing it to zero regardless of any further micro-accrual within the same block.
- The approval reset at the end clears any unused allowance.

### Note on `executeWithToken` amount validation

The REPAY path enters via `executeWithToken` which currently validates that `msg.value == envelope.amount`. When `envelope.amount == type(uint256).max`, the ITS token amount bridged must equal `borrowBalanceCurrent`. The client must query the borrow balance before submitting, send that exact XRP amount via ITS, and encode `type(uint256).max` in the intent envelope as the signal. The adapter reads the actual transferred amount from the ITS callback (`amount` parameter) and uses it for the transfer — the sentinel only affects what is passed to `repayBorrow`.

> **Client-side change required:** When the user selects "Repay All" in the dapp, the client must:
> 1. Call `borrowBalanceCurrent` (or use a slightly inflated estimate with a buffer) to determine how much XRP to send via ITS.
> 2. Encode `amount = type(uint256).max` in the intent envelope payload.

---

## Fix 2 — `_withdraw()`: Support "Withdraw All"

### Current code (`XRPLSecurdBridgeAdapter.sol` line ~488)

```solidity
function _withdraw(address proxy, address market, uint256 amount) internal {
    bytes memory out =
        _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.redeemUnderlying.selector, amount));
    _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.WITHDRAW), out);
}
```

### Problem

`redeemUnderlying(amount)` redeems a fixed quantity of underlying XRP. The exchange rate increases every block. If the user encodes `N XRP` but by execution the balance is `N + delta`, `delta` remains as dust cTokens in the proxy forever. The user cannot withdraw their full position.

### Fixed code

```solidity
function _withdraw(address proxy, address market, uint256 amount) internal {
    bytes memory out;

    if (amount == 0) {
        // Sentinel: redeem all cTokens. Uses redeem(cTokenBalance) so the full position
        // is exited regardless of exchange rate drift between intent signing and execution.
        uint256 cTokenBalance = IERC20(market).balanceOf(proxy);
        out = _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.redeem.selector, cTokenBalance));
    } else {
        out = _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.redeemUnderlying.selector, amount));
    }

    _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.WITHDRAW), out);
}
```

### How it works

- When `envelope.amount == 0`, the adapter reads `balanceOf(proxy)` on the cToken contract to get the current cToken balance, then calls `redeem(cTokenBalance)`.
- Compound V2 converts all cTokens at the current exchange rate, returning 100% of the underlying XRP to the proxy.
- The adapter's `_egress()` then bridges that full amount back to XRPL.
- When `envelope.amount > 0`, behavior is unchanged — `redeemUnderlying` is called for partial withdrawals.

### Amount passed to `_egress()`

When `amount == 0` (withdraw all), the `envelope.amount` passed to `_egress()` is also 0, which would cause `interchainTransfer` to bridge 0 XRP. The egress call must use the actual redeemed amount instead. Update the WITHDRAW dispatch site:

```solidity
// In execute() / executeWithToken() WITHDRAW branch:
} else if (envelope.actionType == uint8(XRPLSecurdTypes.ActionType.WITHDRAW)) {
    uint256 egressAmount = _withdraw(proxy, envelope.market, envelope.amount);
    hasEgress = true;
    if (envelope.amount == 0) envelope.amount = egressAmount; // patch for egress
}
```

And update `_withdraw()` to return the actual redeemed underlying amount:

```solidity
function _withdraw(address proxy, address market, uint256 amount) internal returns (uint256 redeemed) {
    bytes memory out;

    if (amount == 0) {
        uint256 cTokenBalance = IERC20(market).balanceOf(proxy);
        // Snapshot underlying before and after to determine actual redeemed amount.
        uint256 underlyingBefore = address(proxy).balance; // for native XRP market
        out = _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.redeem.selector, cTokenBalance));
        uint256 underlyingAfter = address(proxy).balance;
        redeemed = underlyingAfter - underlyingBefore;
    } else {
        out = _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.redeemUnderlying.selector, amount));
        redeemed = amount;
    }

    _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.WITHDRAW), out);
}
```

> **Note on ERC-20 markets (sSTST):** For ERC-20 underlying, replace `address(proxy).balance` with `IERC20(underlying).balanceOf(proxy)` before and after. The dispatch site knows the underlying from `envelope.underlying`.

> **Client-side change required:** When the user selects "Withdraw All" in the dapp, encode `amount = 0` in the intent envelope. No XRP needs to be sent via ITS (it is a GMP-only call). The dapp should show the estimated redemption amount by calling `balanceOf(proxy) * exchangeRateStored / 1e18` for display purposes, with a note that the actual amount may be slightly higher due to accrued interest.

---

## Upgrade Strategy

Both fixes are in `_repay()` and `_withdraw()` — internal functions only called within the adapter. There are no interface changes to cTokens, the Comptroller, or the proxy contracts.

**However, the adapter cannot be redeployed** without losing access to existing user positions, because:
- `XRPLUserProxy.controller` is `immutable` (set at construction)
- `XRPLUserProxyFactory.setController()` is frozen once any proxy exists
- CREATE2 proxy addresses are derived from the controller address; a new adapter → new proxy addresses → old cToken balances unreachable

The correct path is to make the adapter **upgradeable** (UUPS or Transparent proxy pattern). The adapter address stays constant, the implementation is swapped.

See the Upgrade Path section below.

---

## Upgrade Path (Production Recommendation)

### Step 1 — Wrap adapter in a UUPS proxy

Replace the direct `XRPLSecurdBridgeAdapter` deployment with:

```
UUPSProxy (permanent address, recorded in ProxyFactory as controller)
    └── XRPLSecurdBridgeAdapterV1 (current implementation)
    └── XRPLSecurdBridgeAdapterV2 (with these fixes, future upgrade)
```

Changes required:
- Inherit `UUPSUpgradeable` from OpenZeppelin instead of `Ownable` directly
- Replace constructor state init with `initialize()` (called once via proxy)
- Add `_authorizeUpgrade(address)` restricted to owner

### Step 2 — Deploy V2 implementation with fixes

Deploy only the new implementation contract (no proxy, no factory changes). Call `upgradeTo(v2Address)` from the owner wallet.

### Step 3 — Testnet workaround (before UUPS is in place)

For the current testnet deployment with one active user:
1. Have the user submit a WITHDRAW intent with `amount = envelope.amount` set to their exact current underlying balance (read from `exchangeRateStored * cTokenBalance / 1e18` at the latest block, add a small buffer).
2. If dust cTokens remain after withdrawal, the admin can call a one-off rescue function (to be added) that redeems residual cTokens and returns XRP to the user's proxy for manual bridging.

---

## Summary of Changes

| Location | Change | Sentinel |
|----------|--------|---------|
| `_repay()` | Call `borrowBalanceCurrent` then `repayBorrow(type(uint256).max)` | `envelope.amount == type(uint256).max` |
| `_withdraw()` | Call `redeem(cTokenBalance)` and return actual redeemed amount | `envelope.amount == 0` |
| WITHDRAW dispatch | Patch `envelope.amount` with actual redeemed amount before `_egress()` | Same |
| Dapp client | Encode sentinel values and display estimated amounts to user | N/A |
| Adapter deployment | Wrap in UUPS proxy to allow future upgrades without losing user data | N/A |

---

## Implementation Notes (2026-07-24)

The shipped fix keeps the two sentinels distinct, matching `REPAY_ALL`/`WITHDRAW_ALL` as already
named in [xrpl-evm-sdk-specification.md](xrpl-evm-sdk-specification.md):

- `envelope.amount == type(uint256).max` → repay all (`REPAY_ALL`)
- `envelope.amount == 0` → withdraw all (`WITHDRAW_ALL`)

For WITHDRAW, `_validateEnvelopeBase`'s existing `amount == 0 → InvalidAmount` guard is relaxed
specifically for `ActionType.WITHDRAW` (0 was never a meaningful literal withdraw amount anyway, so
reusing it as a sentinel doesn't create ambiguity). REPAY keeps the zero-amount guard as-is, since
`REPAY_ALL` already uses a different, nonzero sentinel value.

### Fix 1 (`_repay`) — deviation from the proposal above

The codebase already has an `AmountMismatch` check in `executeWithInterchainToken` that requires
`envelope.amount == amount` (the amount actually delivered by ITS in this call). The original
proposal's `_repay` — funding the proxy with `borrowBalanceCurrent(proxy)` pulled from the
**adapter's general token balance** — would either always trip that check, or (if bypassed
naively) let a repay-all intent pull tokens the adapter is holding for unrelated purposes/users
rather than the tokens genuinely bridged in that call.

Shipped behavior instead:
- `executeWithInterchainToken` skips the exact-match check only when `actionType == REPAY` and
  `envelope.amount == type(uint256).max`. The real bridged amount is still passed through as
  `amount` — untouched, no forgery of a different value.
- `_repay(proxy, market, underlying, amount, repayAll)` funds the proxy with exactly `amount` (the
  real bridged tokens), approves the market for `amount`, then calls `repayBorrow(type(uint256).max)`
  when `repayAll` is set. Compound V2 internally caps the pull at the proxy's live borrow balance:
  - If the live debt exceeds `amount`, `repayBorrow`'s internal `transferFrom` reverts (insufficient
    balance/allowance) — the whole call reverts safely instead of reaching into unrelated funds.
  - If the live debt is less than `amount` (client sent a buffer), the surplus remains as ordinary
    ERC20 underlying dust in the user's own proxy — recoverable in principle (e.g. a future
    proxy-sweep admin action), unlike the original bug's unredeemable cToken dust.
- Client-side guidance is unchanged: query `borrowBalanceCurrent` before submitting and send that
  amount (optionally with a small buffer, matching the dapp design spec's existing +0.5% max-repay
  buffer) via ITS, with `amount = type(uint256).max` in the signed envelope.

### Fix 2 (`_withdraw`) — same shape as proposed, with the sentinel change noted above

- `envelope.amount == type(uint256).max` → `_withdraw` reads the proxy's cToken balance and calls
  `redeem(cTokenBalance)`, returning the actual redeemed underlying (measured via before/after
  balance diff on the proxy, which is also robust to fee-on-transfer underlying tokens).
  `envelope.amount != type(uint256).max` → unchanged `redeemUnderlying(amount)` path.
- The WITHDRAW dispatch site in `execute()` patches `envelope.amount` with the actual redeemed
  amount before `_egress` runs, so the bridged-out amount (and the `IntentExecuted` event) reflect
  the real redemption, not `0` or `type(uint256).max`.

### Known residual limitation

If a repay-all leaves underlying-token dust in the proxy (client overestimated the buffer), that
dust is not automatically swept by a later withdraw-all — `_withdraw`'s before/after diff only
captures the amount produced by the `redeem` call itself. This is a UX/completeness gap, not a
fund-safety issue (the dust is the user's own token balance sitting in their own isolated proxy,
not lost or accessible to anyone else). A follow-up could add an owner- or user-triggered
`sweepProxyToken` admin path if this proves material in practice.

### Test coverage

`test/integration/bridgeAdapter.spec.ts` adds:
- `supports repay-all via the type(uint256).max sentinel, clearing accrued-interest dust`
- `rejects repay-all when the bridged token amount cannot cover the live debt`
- `still enforces the exact amount match for ordinary (non-sentinel) repay`
- `supports withdraw-all via the type(uint256).max sentinel, redeeming the full cToken balance`

`contracts/mocks/MockCErc20Market.sol` was extended with `borrowBalanceOf`/`setBorrowBalance`,
`balanceOf`/`setCTokenBalance`, `setExchangeRateMantissa`, and a `redeem()` implementation, plus a
`repayBorrow` that mirrors `CToken.repayBorrowFresh`'s `type(uint256).max` capping behavior, so
these paths can be exercised in isolation from the real `CToken`/`CErc20` contracts.
