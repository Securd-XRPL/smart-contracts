# Securd — How to Trust the STST Token on XRPL Ledger

## What is a Trustline?

On the XRPL Ledger, native XRP is the only asset that any account can hold by default.
Every other token (called an **IOU**) requires the receiving account to explicitly declare
it trusts that token from a specific issuer — this declaration is called a **trustline**.

**Without a trustline, your XRPL wallet cannot receive STST.**
This applies to:
- Receiving STST borrowed from the Securd lending pool
- Receiving STST withdrawn from the Securd lending pool
- Receiving STST sent by any other party

You only need to create the trustline **once**. After that, your wallet can send and receive
STST freely.

---

## STST Token Details (XRPL Testnet)

| Field | Value |
|---|---|
| **Token name** | STST (USD-pegged stablecoin) |
| **Currency code** | `5354535400000000000000000000000000000000` (hex-encoded `"STST"`) |
| **Issuer** | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` (Axelar testnet gateway) |
| **Network** | XRPL Testnet (`wss://s.altnet.rippletest.net:51233`) |

> **Why the Axelar gateway as issuer?**
> STST arrives on XRPL via the Axelar ITS bridge. Axelar acts as the canonical issuer on
> the XRPL side — all bridged STST tokens are IOUs issued by the Axelar gateway address.

---

## Option A — Using the XRPL Web Wallet (Xaman / XUMM)

1. Open your wallet and go to **Add Asset** or **Trust Token**.
2. Enter:
   - **Issuer**: `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2`
   - **Currency**: `STST`
   - **Limit**: `1000000000` (1 billion — effectively unlimited)
3. Confirm and sign the transaction.
4. The trustline is now open. Your wallet will show a 0 STST balance, ready to receive.

---

## Option B — Using the XRPL Testnet UI (XRPL Explorer)

1. Go to [https://test.bithomp.com](https://test.bithomp.com) or the XRPL testnet faucet.
2. Connect your account.
3. Submit a **TrustSet** transaction manually with the JSON below.

---

## Option C — Raw XRPL Transaction (TrustSet)

This is the raw transaction you need to submit to the XRPL Ledger:

```json
{
  "TransactionType": "TrustSet",
  "Account": "<your XRPL address>",
  "LimitAmount": {
    "currency": "5354535400000000000000000000000000000000",
    "issuer":   "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
    "value":    "1000000000"
  }
}
```

| Field | Explanation |
|---|---|
| `Account` | Your XRPL wallet address |
| `currency` | Hex-encoded currency code for `"STST"` (40 hex chars = 20 bytes) |
| `issuer` | The Axelar gateway address — the entity that issued this STST on XRPL |
| `value` | Maximum amount of STST you agree to hold (trust limit). `1000000000` = 1 billion |

> **Fee:** A TrustSet costs ~12 XRP drops (~0.000012 XRP) in transaction fees plus
> a **reserve of 2 XRP** that is locked in your account for each trustline you hold.
> The 2 XRP reserve is returned if you ever delete the trustline.

---

## Option D — Using the Script (`openXrplTrustline.ts`)

The repository includes a ready-made script:

### Dry run (shows what will be submitted, does not send)

```bash
XRPL_SEED=sXXXXXX... \
npx hardhat run scripts/openXrplTrustline.ts --network xrplEvm
```

Output:
```json
{
  "dryRun": true,
  "account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "currency": "5354535400000000000000000000000000000000",
  "issuer": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "limit": "1000000000"
}

Set XRPL_CONFIRM_SEND=true to submit this TrustSet transaction.
```

### Live submission

```bash
XRPL_SEED=sXXXXXX... \
XRPL_CONFIRM_SEND=true \
npx hardhat run scripts/openXrplTrustline.ts --network xrplEvm
```

Output on success:
```
Trustline opened. XRPL tx: https://testnet.xrpl.org/transactions/<hash>
```

### Override defaults (different issuer or limit)

```bash
XRPL_SEED=sXXXXXX... \
TRUSTLINE_ISSUER=rOtherIssuerAddress... \
TRUSTLINE_LIMIT=500000 \
XRPL_CONFIRM_SEND=true \
npx hardhat run scripts/openXrplTrustline.ts --network xrplEvm
```

---

## How the Currency Code Is Derived

XRPL supports two currency code formats:
- **3-character ASCII** (e.g. `USD`, `BTC`) — for legacy tokens
- **20-byte hex** (40 hex characters) — for tokens whose name doesn't fit 3 chars

`STST` is 4 characters, so it uses the hex format:

```
"STST" in ASCII:
  S = 0x53
  T = 0x54
  S = 0x53
  T = 0x54

Padded to 20 bytes:
  5354535400000000000000000000000000000000
```

---

## Verify the Trustline Was Created

After submitting, verify using the XRPL account_lines API:

```bash
curl -s -X POST https://s.altnet.rippletest.net:51234 \
  -H "Content-Type: application/json" \
  -d '{
    "method": "account_lines",
    "params": [{
      "account": "<your XRPL address>",
      "peer":    "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2"
    }]
  }' | jq '.result.lines[] | select(.currency == "5354535400000000000000000000000000000000")'
```

Expected response:
```json
{
  "account": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "balance": "0",
  "currency": "5354535400000000000000000000000000000000",
  "limit": "1000000000",
  "limit_peer": "0",
  "quality_in": 0,
  "quality_out": 0
}
```

A `balance` of `"0"` and a `limit` of `"1000000000"` confirms the trustline is open and ready.

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `tecNO_LINE_INSUF_RESERVE` | Account has insufficient XRP reserve | Add at least 2 XRP to your account first |
| `temBAD_LIMIT` | Limit value is negative or malformed | Use a positive number like `"1000000000"` |
| `tecNO_DST` | Issuer address does not exist on this network | Verify you are on the correct network (testnet vs mainnet) |
| Payment fails with `tecPATH_DRY` | Trustline not open yet | Run TrustSet first, then retry the payment |

---

## Summary

| Step | Action |
|---|---|
| 1 | Get your XRPL wallet address and seed |
| 2 | Make sure your account holds at least **3 XRP** (2 XRP reserve + fees) |
| 3 | Submit a **TrustSet** transaction with currency `5354535400000000000000000000000000000000` and issuer `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |
| 4 | Verify with `account_lines` — balance should be `"0"`, limit `"1000000000"` |
| 5 | Your wallet can now receive STST from the Securd lending pool and any other source |
