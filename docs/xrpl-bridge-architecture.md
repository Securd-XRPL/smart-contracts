# Securd XRPL Bridge — Architecture & Dapp Integration Guide

## Overview

Securd allows users holding assets on the **XRPL Ledger** to supply, borrow, repay, and withdraw from Securd's lending markets deployed on **XRPL EVM** — without ever bridging to XRPL EVM themselves.

The bridge is built on **Axelar GMP** (General Message Passing) and **Axelar ITS** (Interchain Token Service). Every user action on XRPL Ledger is an ordinary XRPL Payment transaction carrying an encoded, signed intent in its memos.

---

## Key Actors and Contracts

### 1. XRPL Ledger side

| Actor | Description |
|---|---|
| **User XRPL wallet** | The user's native XRPL address (e.g. `rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB`) |
| **Axelar XRPL Gateway** | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` — the Axelar relayer address on XRPL. All payments are sent here. |

### 2. XRPL EVM side

| Contract | Address | Role |
|---|---|---|
| **XRPLSecurdBridgeAdapter** | `0x7AC8Df85448037c6fE1eD5732c6ca71060069237` | Central entry point. Receives relayed messages from Axelar, verifies intent signatures, and dispatches actions to user proxies. |
| **XRPLUserProxyFactory** | `0xB7f3ECe856063F48BC3bcC7A381aE875841663aA` | Deploys one `XRPLUserProxy` per XRPL account on demand. |
| **XRPLUserProxy** (per user) | e.g. `0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86` | The user's personal smart contract wallet on XRPL EVM. Holds all positions. Controlled exclusively by the adapter. |
| **Comptroller** | `0x46d364257112230022E72b086Df85a6b0f8D3F86` | Compound V2 risk engine. |
| **sXRP / sSTST cTokens** | see deployment file | The lending markets. |

---

## Two Addresses, Two Roles

This is the most important concept to understand.

### EVM Signer Address (MetaMask)

- Held by the user off-chain
- **Only used to sign intent envelopes** — a cryptographic proof that the user authorized a specific action
- Never directly interacts with any Securd contract
- Registered once in the adapter via `setIntentSigner` (admin-only)
- Invisible to the lending protocol

### Proxy Address (XRPLUserProxy)

- A smart contract deployed automatically on XRPL EVM
- **The actual participant in Securd** — holds cToken balances, borrow positions, receives tokens
- Controlled exclusively by the adapter (`onlyController`)
- The user never calls it directly; the adapter calls it on their behalf
- Deployed deterministically via CREATE2 the first time the user's intent is relayed

```
User's XRPL wallet:   rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB
        ↓ keccak256(utf8)
xrplAccount hash:     0xb2e986...
        ↓ CREATE2 (on first relay)
User's proxy:         0x4409B6F9...   ← holds all Securd positions
```

---

## Intent Signature System

### Why it exists

The adapter lives on XRPL EVM and executes financial operations (supply, borrow, repay, withdraw) on behalf of users. Anyone can send an XRPL Payment to the Axelar gateway — so the adapter needs proof that the owner of the XRPL wallet actually authorized a specific action.

XRPL payments cannot carry EVM signatures natively in the `Amount` or `Account` fields. The solution: **attach an off-chain EVM signature inside the memo payload**.

### How it works

**Step 1 — Admin registers the user (once)**

The Securd admin calls on XRPL EVM:
```solidity
adapter.setIntentSigner(
    keccak256(abi.encodePacked(utf8("rPpamG..."))),  // xrplAccount hash
    0xUserEvmSignerAddress                            // user's MetaMask address
)
```
This stores the mapping: `xrplAccount hash → trusted EVM signer address`.

> `setIntentSigner` is `onlyOwner`. Only the Securd admin can call it. Users cannot self-register.

**Step 2 — User signs the intent (every action)**

Before sending any XRPL Payment, the dapp asks the user to sign an intent envelope with their EVM wallet (MetaMask `eth_sign`). The envelope contains:

```
intentId          — unique ID for this action
xrplAccount       — keccak256 of their XRPL address
market            — cToken address (e.g. sXRP)
underlying        — token address (e.g. 0xEeee...EEE for XRP)
actionType        — SUPPLY=0, BORROW=1, REPAY=2, WITHDRAW=3, ENTER=4, EXIT=5
amount            — amount in EVM decimals (18 decimals)
nonce             — sequential, prevents replay
deadline          — expiry timestamp
destinationAddress— XRPL address to receive egress tokens (BORROW/WITHDRAW)
version           — 1
```

The digest signed is:
```
keccak256(abi.encode(adapterAddress, chainId, keccak256(abi.encode(envelope))))
```

**Step 3 — User submits XRPL Payment**

The signed intent (envelope + EVM signature) is ABI-encoded and placed in the `payload` memo of an XRPL Payment sent to the Axelar gateway.

**Step 4 — Axelar relays to XRPL EVM**

The adapter's `execute` (GMP) or `executeWithToken` (ITS) is called by the Axelar relayer.

**Step 5 — Adapter verifies and executes**

```solidity
function _validateIntentSignature(bytes32 xrplAccount, bytes32 payloadHash, bytes memory signature) {
    address expectedSigner = intentSignerOfXrplAccount[xrplAccount];
    if (expectedSigner == address(0)) revert IntentSignerNotConfigured(xrplAccount);
    address recoveredSigner = ECDSA.recover(payloadHash, signature);
    if (recoveredSigner != expectedSigner) revert InvalidIntentSignature(...);
}
```

If valid, the adapter calls the user's proxy to execute the action on the Compound markets.

---

## XRPL Transaction Format

### For XRP (native) — SUPPLY, ENTER_MARKET, BORROW, REPAY, EXIT_MARKET, WITHDRAW

```
TransactionType: Payment
Account:         <user XRPL address>
Amount:          <drops as integer string, e.g. "10000000">
Destination:     rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2  (Axelar gateway)
Memos:
  type:                interchain_transfer
  destination_address: 7AC8DF85448037C6FE1ED5732C6CA71060069237  (adapter, UTF-8 hex, no 0x)
  destination_chain:   xrpl-evm
  gas_fee_amount:      0  (drops, default 0)
  payload:             <ABI-encoded SignedIntent as raw hex>
```

Amount scaling: `drops × 10^12 = EVM wei`
(XRP has 6 decimal places on XRPL, 18 on XRPL EVM)

### For IOU tokens (STST) — SUPPLY, REPAY

Gas is taken **from the token itself**, not from XRP drops.

```
TransactionType: Payment
Account:         <user XRPL address>
Amount:          { currency: "5354535400...", issuer: <gateway>, value: "<supply + gasFee>" }
Destination:     rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
Memos:
  type:                interchain_transfer
  destination_address: 7AC8DF85448037C6FE1ED5732C6CA71060069237
  destination_chain:   xrpl-evm
  gas_fee_amount:      2  (in IOU units, e.g. "2" STST)
  payload:             <ABI-encoded SignedIntent>
```

Amount sent = `supplyAmount + gasFee` (e.g. 12 STST for 10 STST supply + 2 STST gas)
Intent envelope `amount` = `supplyAmount` only (e.g. `parseEther("10")`)

### For GMP-only actions (ENTER_MARKET, EXIT_MARKET, BORROW, WITHDRAW) with any token

```
TransactionType: Payment
Account:         <user XRPL address>
Amount:          "3000000"  (3 XRP in drops — pure gas payment)
Destination:     rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
Memos:
  type:                call_contract
  destination_address: 7AC8DF85448037C6FE1ED5732C6CA71060069237
  destination_chain:   xrpl-evm
  payload:             <ABI-encoded SignedIntent>
```

---

## Complete User Flow (first time)

```
1. USER ONBOARDING (admin action — done once per user)
   ─────────────────────────────────────────────────
   Securd backend calls:
   adapter.setIntentSigner(keccak256("rPpamG..."), 0xUserEvmSigner)

2. USER CONNECTS TO DAPP
   ─────────────────────
   - Connects XRPL wallet (Xumm / GemWallet)
   - Connects EVM wallet (MetaMask) — same address as registered above

3. SUPPLY (example: 10 XRP)
   ──────────────────────────
   a. Dapp reads nonce: adapter.nextNonceByXrplAccount(xrplAccountHash)
   b. Dapp builds intent envelope with market=sXRP, amount=10e18, nonce=N
   c. MetaMask popup: "Sign this intent" → off-chain signature, zero gas
   d. Dapp builds XRPL Payment with signed intent in payload memo
   e. Xumm popup: "Send 10 XRP to Axelar gateway" → user confirms
   f. Axelar relays to XRPL EVM (~30–60s)
   g. Adapter verifies signature, calls proxyFactory.getOrCreateProxy()
      → proxy auto-deployed on first relay (user pays nothing extra)
   h. Proxy calls comptroller.enterMarkets() + cToken.mint()
   i. User's proxy now holds sXRP cTokens

4. ENTER_MARKET, BORROW, REPAY, EXIT_MARKET, WITHDRAW
   Follow the same pattern with their respective actionTypes and amounts.
```

---

## Dapp Integration — Two Options for Intent Signing

The adapter requires every XRPL intent to carry an EVM signature. The Securd admin must call `setIntentSigner` once per user to register whose key will produce that signature. There are two ways to design this.

---

### Option A — User signs their own intents

The admin registers each user's own MetaMask address as their intent signer.

```
adapter.setIntentSigner(keccak256("rAlice..."), 0xAliceMetaMaskAddress)
adapter.setIntentSigner(keccak256("rBob..."),   0xBobMetaMaskAddress)
```

**How to use it:**

1. User opens the dapp and connects **two wallets**: XRPL wallet (Xumm) and EVM wallet (MetaMask)
2. Dapp sends both addresses to the backend
3. Backend (as adapter owner) calls `setIntentSigner(keccak256(xrplAddress), evmAddress)`
4. For every action the user takes:
   - **MetaMask popup** — user signs the intent envelope (off-chain, zero gas)
   - **Xumm popup** — user confirms the XRPL Payment

```
User action: "Supply 10 XRP"
       │
       ├─ MetaMask: "Sign intent" → signature produced
       │
       └─ Xumm: "Send 10 XRP" → XRPL Payment submitted
                      │
               Axelar relays
                      │
              Adapter verifies Alice's signature ✓
                      │
              Alice's proxy supplies 10 XRP
```

**Pros:** User retains full cryptographic control. Nobody can act on their behalf.
**Cons:** Two wallet interactions per action. Requires users to have both an XRPL wallet and a MetaMask wallet.

---

### Option B — Backend signs intents on behalf of users ✅ Recommended

The admin registers a single **backend signer key** for all users. The backend holds this key and signs every intent server-side.

```
adapter.setIntentSigner(keccak256("rAlice..."), 0xBackendSignerAddress)
adapter.setIntentSigner(keccak256("rBob..."),   0xBackendSignerAddress)
adapter.setIntentSigner(keccak256("rPpamG..."), 0xBackendSignerAddress)
```

**How to use it:**

**Step 1 — Admin setup (once)**

The adapter owner calls `setIntentSigner` for the user, registering the backend signer address. This can be triggered automatically when a new user connects their XRPL wallet to the dapp.

The adapter owner address is `0x243CD17C18052dD49B803dB5be3c2907DA6ff783`.
The corresponding private key must be kept in a secure secrets vault (never in the repository).
To call `setIntentSigner`, use the `DEPLOYER_PRIVATE_KEY` environment variable from `.env`.

**Step 2 — User connects (one wallet only)**

The user connects their XRPL wallet (Xumm). No MetaMask required.

**Step 3 — For every action**

The dapp sends the user's intent parameters to the backend API. The backend:
1. Reads the current nonce from the adapter
2. Builds the intent envelope
3. Signs it with the backend signer private key
4. Returns the encoded payload to the frontend

```typescript
// Backend API endpoint example
app.post('/api/build-intent', async (req, res) => {
  const { xrplAddress, action, market, underlying, amountDrops } = req.body

  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplAddress))
  const nonce       = await adapter.nextNonceByXrplAccount(xrplAccount)
  const amountEVM   = BigInt(amountDrops) * 10n**12n   // drops → 18-decimal wei

  const envelope = {
    intentId:           ethers.keccak256(ethers.toUtf8Bytes(`${xrplAddress}:${nonce}:${Date.now()}`)),
    xrplAccount,
    market,
    underlying,
    actionType:         ACTION_TYPES[action],  // SUPPLY=0, BORROW=1, ...
    amount:             amountEVM,
    nonce,
    deadline:           BigInt(Math.floor(Date.now() / 1000) + 600),  // 10 min
    destinationAddress: "0x",
    version:            1
  }

  const payloadHash = hashEnvelope(envelope)
  const digest      = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32"],
      [ADAPTER_ADDRESS, CHAIN_ID, payloadHash]
    )
  )

  // Signed by backend key — user never sees this
  const signature = await backendSigner.signMessage(ethers.getBytes(digest))
  const payload   = encodeSignedIntent(envelope, signature)

  res.json({ payload, totalDrops: amountDrops, gasDrops: "0" })
})
```

The frontend then builds the XRPL Payment using the returned payload and shows a single **Xumm popup** for the user to confirm.

```
User action: "Supply 10 XRP"
       │
       └─ Xumm: "Send 10 XRP" → XRPL Payment submitted   ← only interaction
                      │
               Axelar relays
                      │
           Adapter verifies backend signature ✓
                      │
          User's proxy supplies 10 XRP
```

**Pros:** One wallet only. Simpler UX. No MetaMask required for XRPL-native users.
**Cons:** Backend holds signing authority. Backend key must be secured (HSM / KMS).

---

### Comparison

| | Option A | Option B |
|---|---|---|
| Wallets needed | XRPL + MetaMask | XRPL only |
| Popups per action | 2 (MetaMask + Xumm) | 1 (Xumm only) |
| Who signs intents | User (MetaMask) | Backend server |
| User control | Full self-custody | Delegated to backend |
| Backend key risk | Low (no signing key) | High (must secure backend key) |
| Recommended for | Power users | Consumer dapp |

---

## Root Cause of the Failed Transaction

**TX:** `694F20D87D98128C2F259D32B8D12EB4242FFCCA6599FEC12B162F4687F54D5C`
**Sender:** `rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB`

### What happened

The transaction was correctly formed:
- ✅ XRP drops as Amount (`10000000` = 10 XRP)
- ✅ `type: interchain_transfer`
- ✅ `destination_address`: adapter address
- ✅ `destination_chain: xrpl-evm`
- ✅ `market = sXRP`, `underlying = 0xEeee...` (correct for XRP)
- ✅ `intent.amount = 8e18` (8 XRP net after 2 XRP gas fee)
- ✅ `actionType = 0` (SUPPLY)

It was relayed by Axelar, confirmed on Axelar hub, then reached XRPL EVM.

The adapter's `_validateIntentSignature` checked:

```solidity
address expectedSigner = intentSignerOfXrplAccount[0xb2e986...];
// → returns 0x0000000000000000000000000000000000000000
// → revert IntentSignerNotConfigured
```

**The Securd admin never called `setIntentSigner` for this user's XRPL account.**

On-chain proof:
```
adapter.intentSignerOfXrplAccount(0xb2e986...) → 0x0000...0000
```

### Fix

The Securd admin must call **once**:

```solidity
adapter.setIntentSigner(
    keccak256(abi.encodePacked(bytes("rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB"))),
    <user's EVM signer address>
)
```

After this, the user can resubmit their XRPL Payment (nonce is still 0 — unaffected by the failed relay).

---

## Nonce Rules

- The nonce starts at `0` for every new XRPL account
- It advances by 1 only after a **successfully relayed and executed** intent
- A failed relay (like this one) does **not** advance the nonce
- The user must never submit two intents with the same nonce simultaneously — the second will be rejected
- In case of a stuck nonce, the admin can call `adapter.resetNonce(xrplAccount, newNonce)`

---

## Key Invariants for the Dapp

| Rule | Why |
|---|---|
| Always read nonce from adapter before building an intent | Stale nonces cause silent relay failures |
| `intent.amount` must match net tokens delivered by ITS | For IOU tokens: `amount = totalIOU - gasFee`. Over-repay reverts in Compound |
| `market` and `underlying` in the intent must match the token bridged | Mismatch causes `executeWithToken` to revert |
| For IOU supply/repay: `gas_fee_amount` memo = fee in token units, not drops | Drops-based gas applies only to native XRP payments |
| The proxy address (not EVM signer address) holds all Securd positions | The EVM signer is authorization-only, invisible to Compound |
| `setIntentSigner` must be called by admin before the user's first intent | Without it, every intent from that wallet will fail with `IntentSignerNotConfigured` |
