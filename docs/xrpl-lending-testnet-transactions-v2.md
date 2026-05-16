# XRPL Ledger → XRPL EVM Lending: Testnet Transactions (Post-Audit Redeployment v3)

End-to-end test of all six lending operations including the new ENTER_MARKET and EXIT_MARKET
actions, bridged from XRPL Ledger to the Securd lending protocol on XRPL EVM via Axelar.
Executed after all Almanax security audit fixes and the ENTER/EXIT_MARKET feature were applied.

---

## Accounts

| | Address |
|-|---------|
| **XRPL Ledger wallet** | `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48` |
| **XRPL EVM user proxy** | `0x4F654Fb71f7176fB98A8DB3A9b974201195028ec` |
| **XRPL EVM signer / deployer** | `0x243CD17C18052dD49B803dB5be3c2907DA6ff783` |
| **Bridge adapter** | `0xb457321CF05bC4ACe87d15B5400A5dD944bC444f` |
| **sXRP cToken market** | `0xdC23077B9E2d02Dee0f1F4784D2526e4A20f3869` |
| **Oracle** | `0xC16213F10911767a1011fC42EA253d93130079b4` |
| **XRPLUserProxyFactory** | `0x832774Fa7E8E3B3dcd57208cE6C6bD4648aeF2c7` |
| **Unitroller (Comptroller proxy)** | `0xbD758A39e6e0C601c35655394eCbb88443Ba37A6` |

---

## Transaction 1 — SUPPLY (Deposit 5 XRP as Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar ITS (`interchain_transfer`)
**Action**: User sends 5 XRP. ITS mints 5 XRP on XRPL EVM to the adapter, which supplies it
into the sXRP market and auto-calls `enterMarkets` on the proxy.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/A8C1E9CC594F299F45BCED45046F01A8DDF8821BD56B07913F2672AA88C52870 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/a8c1e9cc594f299f45bced45046f01a8ddf8821bd56b07913f2672aa88c52870 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 1 | **2** |
| Proxy sXRP balance | 5,000,000,000,000,000,000 | **10,000,000,000,000,000,000** |
| Borrow balance | 0 | 0 |
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
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/9B11340C96E8786CB8405C2B24B25E7844E55CD59CDA5E7FC3EA8CC66416F4CB |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/9b11340c96e8786cb8405c2b24b25e7844e55cd59cda5e7fc3ea8cc66416f4cb |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 2 | **3** |
| Proxy sXRP balance | 10,000,000,000,000,000,000 | 10,000,000,000,000,000,000 |
| Borrow balance | 0 | 0 |
| Market membership | **IN** | **OUT** |
| Adapter XRP balance | 5.0 XRP | 5.0 XRP |

### Key Parameters

```
actionType:       EXIT_MARKET (5)
amount:           0  (no tokens)
gasDrops:         3,000,000
Axelar memo:      type = call_contract
```

---

## Transaction 3 — ENTER_MARKET (Re-enable sXRP as Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar GMP (`call_contract`)
**Action**: User sends a signed ENTER_MARKET intent. The adapter calls
`comptroller.enterMarkets([market])` via the proxy, restoring the sXRP balance as collateral.
Required before borrowing. No tokens move. No egress.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/0408361AF53E18FEB3D9FF1E29F7CE04F8068F487B1F2F319C3A18FF0244EC7C |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/0408361af53e18feb3d9ff1e29f7ce04f8068f487b1f2f319c3a18ff0244ec7c |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 3 | **4** |
| Proxy sXRP balance | 10,000,000,000,000,000,000 | 10,000,000,000,000,000,000 |
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
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/D81CAB6F712B5D6C56F5B574186C66FEDB85D8F33EADF9A6B28286A12E055084 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/d81cab6f712b5d6c56f5b574186c66fedb85d8f33eadf9a6b28286a12e055084 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 4 | **5** |
| Proxy sXRP balance | 10,000,000,000,000,000,000 | 10,000,000,000,000,000,000 |
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
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/A993EC79770E3A3A7CE6BDE6E693B1586BEA99532C1EC195CB2B5C92FBE59C5D |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/a993ec79770e3a3a7ce6bde6e693b1586bea99532c1ec195cb2b5c92fbe59c5d |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 5 | **6** |
| Proxy sXRP balance | 10,000,000,000,000,000,000 | 10,000,000,000,000,000,000 |
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
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/B578405EE84F612467A954ADE987032F48124D9D863F21B28621F99D63FA44DB |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/b578405ee84f612467a954ade987032f48124d9d863f21b28621f99d63fa44db |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 6 | **7** |
| Proxy sXRP balance | 10,000,000,000,000,000,000 | **8,000,000,000,000,000,000** |
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
| Nonce | **7** |
| Proxy sXRP balance | **8,000,000,000,000,000,000** (8 XRP collateral) |
| Proxy borrow balance | **0** (fully repaid) |
| Adapter XRP balance | **3.0 XRP** (5 funded − 2 egress) |

---

## Flow Summary

```
SUPPLY       → ITS interchain_transfer → XRP inbound    → cToken.mint() + enterMarkets()
EXIT_MARKET  → GMP call_contract       → no tokens      → comptroller.exitMarket()
ENTER_MARKET → GMP call_contract       → no tokens      → comptroller.enterMarkets()
BORROW       → GMP call_contract       → gas only       → cToken.borrow() + ITS egress
REPAY        → ITS interchain_transfer → XRP inbound    → cToken.repayBorrow()
WITHDRAW     → GMP call_contract       → gas only       → cToken.redeemUnderlying() + ITS egress
```

| Action | Axelar mechanism | Tokens from XRPL? | Tokens back to XRPL? | nonce |
|--------|-----------------|-------------------|----------------------|-------|
| SUPPLY | ITS `interchain_transfer` | Yes (5 XRP + 2 XRP gas) | No | 1→2 |
| EXIT_MARKET | GMP `call_contract` | No (3 XRP gas only) | No | 2→3 |
| ENTER_MARKET | GMP `call_contract` | No (3 XRP gas only) | No | 3→4 |
| BORROW | GMP `call_contract` | No (3 XRP gas only) | Yes (1 XRP borrowed) | 4→5 |
| REPAY | ITS `interchain_transfer` | Yes (1 XRP + 2 XRP gas) | No | 5→6 |
| WITHDRAW | GMP `call_contract` | No (3 XRP gas only) | Yes (2 XRP redeemed) | 6→7 |
