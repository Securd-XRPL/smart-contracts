# XRPL Ledger → XRPL EVM Lending: Testnet Transactions (Post-Audit Redeployment)

End-to-end test of all four lending operations bridged from XRPL Ledger to the Securd lending
protocol on XRPL EVM via Axelar. Executed after the Almanax security audit fixes were applied
and contracts were redeployed.

---

## Accounts

| | Address |
|-|---------|
| **XRPL Ledger wallet** | `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48` |
| **XRPL EVM user proxy** | `0x02b79e2c6D91B384ddD1767F8C4321D2ACBBEFE8` |
| **XRPL EVM signer / deployer** | `0x243CD17C18052dD49B803dB5be3c2907DA6ff783` |
| **Bridge adapter** | `0xf1CBD0f07580ff9A0961cB97758363f42D95df20` |
| **sXRP cToken market** | `0xcD881baC550Ae161942c93CF393822E97c745811` |
| **Oracle** | `0x3e4B7874A46815F49eBebE598213ecEda260ca04` |

---

## Transaction 1 — SUPPLY (Deposit 5 XRP as Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar ITS (`interchain_transfer`)
**Action**: User sends 5 XRP from XRPL Ledger. ITS mints 5 XRP on XRPL EVM to the adapter,
which supplies it into the sXRP lending market and enters the market as collateral.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/48D103A375DEF6FA7D6CB33E026C7A6312A12D8E503AAC18A0D6680849165362 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/48d103a375def6fa7d6cb33e026c7a6312a12d8e503aac18a0d6680849165362 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 0 | **1** |
| Proxy sXRP balance | 0 | **5,000,000,000,000,000,000** |
| Borrow balance | 0 | 0 |
| Adapter XRP balance | 10.0 XRP (pre-funded) | 10.0 XRP |

### Key Parameters

```
actionType:       SUPPLY (0)
amount:           5,000,000,000,000,000,000 wei  (5 XRP × 10^12 scaling)
depositDrops:     5,000,000
gasFeeDrops:      2,000,000
totalPayment:     7,000,000 drops
Axelar memo:      type = interchain_transfer
```

---

## Transaction 2 — WITHDRAW (Redeem 2 XRP Back to XRPL Ledger)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`) → ITS egress back to XRPL Ledger
**Action**: User sends a signed WITHDRAW intent from XRPL Ledger with gas only (no tokens).
The adapter redeems 2 XRP from the lending market via the proxy and sends it back to the
user's XRPL wallet via ITS.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/4D084B8E78E79CCB6DFDBBC3B540B7F40F98904029285DCD2313B3E9CC69DC62 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/4d084b8e78e79ccb6dfdbbc3b540b7f40f98904029285dcd2313b3e9cc69dc62 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 1 | **2** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | **3,000,000,000,000,000,000** |
| Borrow balance | 0 | 0 |
| Adapter XRP balance | 10.0 XRP | **9.0 XRP** (1 XRP used for egress gas) |
| XRPL wallet received | — | **2,000,000 drops (2 XRP)** |

### Key Parameters

```
actionType:        WITHDRAW (3)
amount:            2,000,000,000,000,000,000 wei  (2 XRP in 18-decimal)
gasDrops:          3,000,000  (gas only — no token transfer inbound)
Axelar memo:       type = call_contract
destinationAddress: UTF-8 bytes of r4obbPExFxVcmqUBr5jepsdtDLX3htdq48
egressGasValue:    1.0 XRP
```

---

## Transaction 3 — BORROW (Borrow 1 XRP Against sXRP Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`) → ITS egress back to XRPL Ledger
**Action**: User sends a signed BORROW intent with gas only. The adapter borrows 1 XRP from
the lending market via the proxy and sends it back to the user's XRPL wallet via ITS.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/A0E1E2999BFD35273B141A07F7EBCD582D17141AFCAC7D0A536E34CA2C760420 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/a0e1e2999bfd35273b141a07f7ebcd582d17141afcac7d0a536e34ca2c760420 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 2 | **3** |
| Proxy sXRP balance | 3,000,000,000,000,000,000 | 3,000,000,000,000,000,000 |
| Borrow balance | 0 | **1,000,000,000,000,000,000** (1 XRP) |
| Adapter XRP balance | 9.0 XRP | **8.0 XRP** (1 XRP used for egress gas) |
| XRPL wallet received | — | **1,000,000 drops (1 XRP)** |

### Key Parameters

```
actionType:        BORROW (1)
amount:            1,000,000,000,000,000,000 wei  (1 XRP in 18-decimal)
gasDrops:          3,000,000  (gas only — no token transfer inbound)
Axelar memo:       type = call_contract
destinationAddress: UTF-8 bytes of r4obbPExFxVcmqUBr5jepsdtDLX3htdq48
egressGasValue:    1.0 XRP
```

---

## Transaction 4 — REPAY (Repay the 1 XRP Borrow)

**Flow**: XRPL Ledger → XRPL EVM via Axelar ITS (`interchain_transfer`)
**Action**: User sends 1 XRP + 2 XRP gas from XRPL Ledger. ITS mints the repay amount on XRPL EVM
to the adapter, which calls `repayBorrow()` via the user proxy, clearing the debt.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/D4353F7172E458B2AC24F307D4C2F996B7B2885DA27E99C9EA633AB6A13A7577 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/d4353f7172e458b2ac24f307d4c2f996b7b2885da27e99c9ea633ab6a13a7577 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 3 | **4** |
| Proxy sXRP balance | 3,000,000,000,000,000,000 | 3,000,000,000,000,000,000 |
| Borrow balance | 1,000,000,000,000,000,000 | **0** (fully repaid) |
| Adapter XRP balance | 8.0 XRP | 8.0 XRP |

### Key Parameters

```
actionType:    REPAY (2)
amount:        1,000,000,000,000,000,000 wei  (1 XRP × 10^12 scaling)
repayDrops:    1,000,000
gasFeeDrops:   2,000,000
totalPayment:  3,000,000 drops
Axelar memo:   type = interchain_transfer
```

---

## Final State (All Operations Confirmed)

| Metric | Value |
|--------|-------|
| Nonce | **4** |
| Proxy sXRP balance | **3,000,000,000,000,000,000** (3 XRP collateral) |
| Proxy borrow balance | **0** (fully repaid) |
| Adapter XRP balance | **8.0 XRP** (10 funded − 2 egress) |

---

## Flow Summary

```
SUPPLY  → ITS interchain_transfer  → XRP sent inbound  → cToken.mint()             → sXRP minted to proxy
WITHDRAW→ GMP call_contract        → gas only inbound  → cToken.redeemUnderlying() → XRP returned to XRPL
BORROW  → GMP call_contract        → gas only inbound  → cToken.borrow()           → XRP returned to XRPL
REPAY   → ITS interchain_transfer  → XRP sent inbound  → cToken.repayBorrow()      → debt cleared
```

| Action | Axelar mechanism | Tokens from XRPL? | Tokens back to XRPL? | nonce |
|--------|-----------------|-------------------|----------------------|-------|
| SUPPLY | ITS `interchain_transfer` | Yes (5 XRP + 2 XRP gas) | No | 0→1 |
| WITHDRAW | GMP `call_contract` | No (3 XRP gas only) | Yes (2 XRP redeemed) | 1→2 |
| BORROW | GMP `call_contract` | No (3 XRP gas only) | Yes (1 XRP borrowed) | 2→3 |
| REPAY | ITS `interchain_transfer` | Yes (1 XRP + 2 XRP gas) | No | 3→4 |
