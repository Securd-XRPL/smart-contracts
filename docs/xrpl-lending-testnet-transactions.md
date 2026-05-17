# XRPL Ledger → XRPL EVM Lending: Testnet Transactions

End-to-end test of all four lending operations bridged from XRPL Ledger to the Securd lending
protocol on XRPL EVM via Axelar. All four transactions executed successfully on testnet.

---

## Accounts

| | Address |
|-|---------|
| **XRPL Ledger wallet** | `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48` |
| **XRPL EVM user proxy** | `0xC48c8DCB701F3e07167092df66643b2b93dB9dAF` |
| **XRPL EVM signer / deployer** | `0x243CD17C18052dD49B803dB5be3c2907DA6ff783` |
| **Bridge adapter** | `0x39CD36305a266E3F9748C182cc16edAc502853b0` |
| **sXRP cToken market** | `0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6` |

---

## Transaction 1 — SUPPLY (Deposit 5 XRP as Collateral)

**Flow**: XRPL Ledger → XRPL EVM via Axelar ITS (`interchain_transfer`)
**Action**: User sends 5 XRP from XRPL Ledger. ITS mints 5 XRP on XRPL EVM to the adapter,
which supplies it into the sXRP lending market and enters the market as collateral.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/1A8D83C216FD412C2FB0891A77EC483B5736DDE8CE7EB13A03D4C2A86B661ED0 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/1a8d83c216fd412c2fb0891a77ec483b5736dde8ce7eb13a03d4c2a86b661ed0 |
| **XRPL EVM tx** | https://explorer.testnet.xrplevm.org/tx/0x6ee52127831c17ce1edf8114e338de022a57e3bd016090de583cd689fe62218e |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 0 | **1** |
| Proxy sXRP balance | 0 sXRP | **50,000,000,000 sXRP** |
| Underlying XRP (proxy) | 0 XRP | **5.0 XRP** |
| Borrow liquidity | $0.00 | **$9.375 USD** |
| sXRP entered as collateral | No | **Yes** |
| XRPL payment | — | 5,000,000 drops deposit + 2,000,000 drops gas |

### Key Parameters

```
actionType:    SUPPLY (0)
amount:        5,000,000,000,000,000,000 wei  (5 XRP × 10^12 scaling)
depositDrops:  5,000,000
gasFeeDrops:   2,000,000
totalPayment:  7,000,000 drops
Axelar memo:   type = interchain_transfer
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
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/D19A2C7D1AE425C82B1909B6CA7852331E03BF45CDB5F9B24D58BBA88712E654 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/d19a2c7d1ae425c82b1909b6ca7852331e03bf45cdb5f9b24d58bba88712e654 |
| **XRPL EVM tx** | https://explorer.testnet.xrplevm.org/tx/0x6ba29b2fcd18629fb2b82292c48581fe76cb009e22605b39bcb26832bda64878 |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 1 | **2** |
| Proxy sXRP balance | 50,000,000,000 sXRP | **30,000,000,000 sXRP** |
| Underlying XRP (proxy) | 5.0 XRP | **3.0 XRP** |
| Borrow liquidity | $9.375 USD | **$5.625 USD** |
| XRPL wallet received | — | **2,000,000 drops (2 XRP)** |
| Adapter XRP balance | 5.0 XRP | **4.0 XRP** (1 XRP used for egress gas) |

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
**Action**: User sends a signed BORROW intent from XRPL Ledger with gas only. The adapter
borrows 1 XRP from the lending market via the proxy (using the existing sXRP as collateral)
and sends it back to the user's XRPL wallet via ITS.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/E8973C506A8BBC05316DD4ED54B4EDE90B2EA4AFEA2B04EE2EA2231DB413B1F5 |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/e8973c506a8bbc05316dd4ed54b4ede90b2ea4afea2b04ee2ea2231db413b1f5 |
| **XRPL EVM tx** | https://explorer.testnet.xrplevm.org/tx/0x7156fdba3fb993cfd14efb758c83a00c359fffb5ece75aa0347bd397c936f6fc |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 2 | **3** |
| Proxy sXRP balance | 30,000,000,000 sXRP | **30,000,000,000 sXRP** (unchanged) |
| Underlying XRP (proxy) | 3.0 XRP | **3.0 XRP** (unchanged) |
| Borrow balance (owed) | 0.0 XRP | **1.0 XRP** |
| Borrow liquidity | $5.625 USD | **$3.125 USD** |
| Shortfall | $0.00 | $0.00 |
| XRPL wallet received | — | **1,000,000 drops (1 XRP)** |
| Adapter XRP balance | 4.0 XRP | **3.0 XRP** (1 XRP used for egress gas) |

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
**Action**: User sends 1 XRP from XRPL Ledger. ITS mints 1 XRP on XRPL EVM to the adapter,
which uses it to call `repayBorrow()` on the sXRP market via the proxy, clearing the debt.

### Explorer Links

| | Link |
|-|------|
| **XRPL Ledger tx** | https://testnet.xrpl.org/transactions/DFC557878533E0DB57FEE770A3B1722342472E682DD01B143329C5E485B4B2AD |
| **Axelarscan GMP** | https://testnet.axelarscan.io/gmp/dfc557878533e0db57fee770a3b1722342472e682dd01b143329c5e485b4b2ad |
| **XRPL EVM tx** | https://explorer.testnet.xrplevm.org/tx/0xca8252d9e2e7a2e240dddf77f45c443256a289f5f350bdba4b79ff09beafd51c |

### Before / After

| Metric | Before | After |
|--------|--------|-------|
| Nonce | 3 | **4** |
| Proxy sXRP balance | 30,000,000,000 sXRP | **30,000,000,000 sXRP** (unchanged) |
| Underlying XRP (proxy) | 3.0 XRP | **3.0 XRP** (unchanged) |
| Borrow balance (owed) | 1.0 XRP | **0.0 XRP** (fully repaid) |
| Borrow liquidity | $3.125 USD | **$5.625 USD** (fully restored) |
| Shortfall | $0.00 | $0.00 |
| XRPL payment | — | 1,000,000 drops repay + 2,000,000 drops gas |

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

## Final State Summary

| Metric | Value |
|--------|-------|
| Nonce | 4 |
| Proxy sXRP balance | 30,000,000,000 sXRP |
| Underlying XRP supplied | 3.0 XRP |
| Borrow balance | 0.0 XRP |
| Available borrow liquidity | $5.625 USD |
| Shortfall | $0.00 |
| sXRP entered as collateral | Yes |

---

## Flow Summary

```
SUPPLY  → ITS interchain_transfer  → XRP sent inbound  → cToken.mint()          → sXRP minted to proxy
WITHDRAW→ GMP call_contract        → gas only inbound  → cToken.redeemUnderlying()→ XRP returned to XRPL
BORROW  → GMP call_contract        → gas only inbound  → cToken.borrow()         → XRP returned to XRPL
REPAY   → ITS interchain_transfer  → XRP sent inbound  → cToken.repayBorrow()    → debt cleared
```

| Action | Axelar mechanism | Tokens from XRPL? | Tokens back to XRPL? | nonce |
|--------|-----------------|-------------------|----------------------|-------|
| SUPPLY | ITS `interchain_transfer` | Yes (deposit + gas) | No | 0→1 |
| WITHDRAW | GMP `call_contract` | No (gas only) | Yes (redeemed XRP) | 1→2 |
| BORROW | GMP `call_contract` | No (gas only) | Yes (borrowed XRP) | 2→3 |
| REPAY | ITS `interchain_transfer` | Yes (repay + gas) | No | 3→4 |
