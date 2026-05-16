# XRPL Ledger → XRPL EVM Lending: Testnet Transactions (Post-Audit Redeployment v4)

End-to-end test of all six lending operations including ENTER_MARKET and EXIT_MARKET
actions, bridged from XRPL Ledger to the Securd lending protocol on XRPL EVM via Axelar.
Executed after all Almanax security audit fixes, the ENTER/EXIT_MARKET feature, and the
removal of auto-enterMarkets from SUPPLY to match Compound V2 design.

---

## Accounts

| | Address |
|-|---------|
| **XRPL Ledger wallet** | `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48` |
| **XRPL EVM user proxy** | `0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86` |
| **XRPL EVM signer / deployer** | `0x243CD17C18052dD49B803dB5be3c2907DA6ff783` |
| **Bridge adapter** | `0x7AC8Df85448037c6fE1eD5732c6ca71060069237` |
| **sXRP cToken market** | `0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318` |
| **Oracle** | `0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80` |
| **XRPLUserProxyFactory** | `0xB7f3ECe856063F48BC3bcC7A381aE875841663aA` |
| **Unitroller (Comptroller proxy)** | `0x46d364257112230022E72b086Df85a6b0f8D3F86` |

---

## Transaction 1 — SUPPLY (Deposit 5 XRP as Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar ITS (`interchain_transfer`)
**Action**: User sends 5 XRP. ITS mints 5 XRP on XRPL EVM to the adapter, which supplies it
into the sXRP market. Market membership is NOT automatically entered (Compound V2 design).

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/4E9D6D6D9DF785875FE8BE453B90A31010AAAFFC4D4ED9E308D387BB4EEBEB22 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/4e9d6d6d9df785875fe8be453b90a31010aaaffc4d4ed9e308d387bb4eebeb22 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 0 | **1** |
| Proxy sXRP balance | 0 | **5,000,000,000,000,000,000** |
| Borrow balance | 0 | 0 |
| Market membership | OUT | OUT (explicit ENTER_MARKET required) |
| Adapter XRP balance | 5.0 XRP | 5.0 XRP |

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

## Transaction 2 — EXIT_MARKET (Remove sXRP from Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`)
**Action**: User sends a signed EXIT_MARKET intent. The adapter calls
`comptroller.exitMarket(market)` via the proxy, removing the sXRP balance from collateral.
No tokens move. No egress.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/FDD4F2DC0A29A6BE0B716E52B5BA89501F25E3CCF164B97341F0A52D7CB61D55 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/fdd4f2dc0a29a6be0b716e52b5ba89501f25e3ccf164b97341f0a52d7cb61d55 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 1 | **2** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | 5,000,000,000,000,000,000 |
| Borrow balance | 0 | 0 |
| Market membership | OUT | **OUT** (confirmed) |
| Adapter XRP balance | 5.0 XRP | 5.0 XRP |

### Key Parameters

```
actionType:       EXIT_MARKET (5)
amount:           0  (no tokens)
gasDrops:         3,000,000
Axelar memo:      type = call_contract
```

---

## Transaction 3 — ENTER_MARKET (Enable sXRP as Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`)
**Action**: User sends a signed ENTER_MARKET intent. The adapter calls
`comptroller.enterMarkets([market])` via the proxy, enabling the sXRP balance as collateral.
Required before borrowing. No tokens move. No egress.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/6BABCEF610BDD6E45D496B3B9914D987524159332A7678FCAC04DEF737CC62A0 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/6babcef610bdd6e45d496b3b9914d987524159332a7678fcac04def737cc62a0 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 2 | **3** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | 5,000,000,000,000,000,000 |
| Borrow balance | 0 | 0 |
| Market membership | OUT | **IN** |
| Adapter XRP balance | 5.0 XRP | 5.0 XRP |

### Key Parameters

```
actionType:       ENTER_MARKET (4)
amount:           0  (no tokens)
gasDrops:         3,000,000
Axelar memo:      type = call_contract
```

---

## Transaction 4 — BORROW (Borrow 1 XRP Against sXRP Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`) → ITS egress to XRPL Ledger
**Action**: User sends a signed BORROW intent. The adapter borrows 1 XRP from the market via
the proxy and sends it back to the user's XRPL wallet via ITS.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/3C100D59273431A0A1C848FAC700B92556F2C8C490C24B9F36B08D46DDC15634 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/3c100d59273431a0a1c848fac700b92556f2c8c490c24b9f36b08d46ddc15634 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 3 | **4** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | 5,000,000,000,000,000,000 |
| Borrow balance | 0 | **1,000,000,000,000,000,000** (1 XRP) |
| Adapter XRP balance | 5.0 XRP | **4.0 XRP** (1 XRP egress gas) |
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

## Transaction 5 — REPAY (Repay the 1 XRP Borrow)

**Flow**: XRPL Ledger → XRPL EVM via Axelar ITS (`interchain_transfer`)
**Action**: User sends 1 XRP + 2 XRP gas. ITS mints the repay amount on XRPL EVM to the
adapter, which calls `repayBorrow()` via the user proxy, clearing the debt.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/9E8CD348401F2F8945638295E755870B43E21A84AA29E2F5EF0F32B459B9497B |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/9e8cd348401f2f8945638295e755870b43e21a84aa29e2f5ef0f32b459b9497b |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 4 | **5** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | 5,000,000,000,000,000,000 |
| Borrow balance | 1,000,000,000,000,000,000 | **0** (fully repaid) |
| Adapter XRP balance | 4.0 XRP | 4.0 XRP |

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

## Transaction 6 — WITHDRAW (Redeem 2 XRP Back to XRPL Ledger)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`) → ITS egress to XRPL Ledger
**Action**: User sends a signed WITHDRAW intent. The adapter redeems 2 XRP from the market
via the proxy and sends it back to the user's XRPL wallet via ITS.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/8A797303C1DF114ED51C8247176D99E1058D638C92D885566788C806996B08B5 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/8a797303c1df114ed51c8247176d99e1058d638c92d885566788c806996b08b5 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 5 | **6** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | **3,000,000,000,000,000,000** |
| Borrow balance | 0 | 0 |
| Adapter XRP balance | 4.0 XRP | **3.0 XRP** (1 XRP egress gas) |
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

## Final State (All Operations Confirmed)

| Metric | Value |
|--------|-------|
| Nonce | **6** |
| Proxy sXRP balance | **3,000,000,000,000,000,000** (3 XRP collateral) |
| Proxy borrow balance | **0** (fully repaid) |
| Adapter XRP balance | **3.0 XRP** (5 funded − 2 egress) |

---

## Flow Summary

```
SUPPLY       → ITS interchain_transfer → XRP inbound    → cToken.mint()
EXIT_MARKET  → GMP call_contract       → no tokens      → comptroller.exitMarket()
ENTER_MARKET → GMP call_contract       → no tokens      → comptroller.enterMarkets()
BORROW       → GMP call_contract       → gas only       → cToken.borrow() + ITS egress
REPAY        → ITS interchain_transfer → XRP inbound    → cToken.repayBorrow()
WITHDRAW     → GMP call_contract       → gas only       → cToken.redeemUnderlying() + ITS egress
```

| Action | Axelar mechanism | Tokens from XRPL? | Tokens back to XRPL? | nonce |
|--------|-----------------|-------------------|----------------------|-------|
| SUPPLY | ITS `interchain_transfer` | Yes (5 XRP + 2 XRP gas) | No | 0→1 |
| EXIT_MARKET | GMP `call_contract` | No (3 XRP gas only) | No | 1→2 |
| ENTER_MARKET | GMP `call_contract` | No (3 XRP gas only) | No | 2→3 |
| BORROW | GMP `call_contract` | No (3 XRP gas only) | Yes (1 XRP borrowed) | 3→4 |
| REPAY | ITS `interchain_transfer` | Yes (1 XRP + 2 XRP gas) | No | 4→5 |
| WITHDRAW | GMP `call_contract` | No (3 XRP gas only) | Yes (2 XRP redeemed) | 5→6 |
