# Securd — XRP Lending Execution Guide
## Complete Step-by-Step Instructions: XRPL Ledger → XRPL EVM

---

## Overview

Every lending action originates as an **XRPL Payment transaction** sent to the Axelar gateway.
The Axelar relayer picks it up and calls the `XRPLSecurdBridgeAdapter` on XRPL EVM, which
executes the action on behalf of the user through their `XRPLUserProxy`.

```
User (XRPL Ledger)
  └─ Payment to Axelar gateway
       └─ Axelar relayer
            └─ XRPLSecurdBridgeAdapter.execute() on XRPL EVM
                 └─ XRPLUserProxy → Compound V2 cToken
```

### Two transport modes

| Mode | XRPL memo `type` | Used for | Tokens move |
|---|---|---|---|
| **ITS interchain_transfer** | `interchain_transfer` | SUPPLY, REPAY | XRPL → EVM |
| **GMP call_contract** | `call_contract` | ENTER_MARKET, EXIT_MARKET, BORROW, WITHDRAW | none (or EVM → XRPL via egress) |

---

## Contract Addresses (XRPL EVM Testnet)

| Contract | Address |
|---|---|
| XRPLSecurdBridgeAdapter | `0x7AC8Df85448037c6fE1eD5732c6ca71060069237` |
| sXRP cToken (market) | `0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318` |
| Underlying (native XRP sentinel) | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |
| XRPLUserProxyFactory | `0xB7f3ECe856063F48BC3bcC7A381aE875841663aA` |
| Axelar gateway (XRPL) | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |
| Destination chain name | `xrpl-evm` |
| Chain ID | `1449000` |

---

## Key Concepts

### xrplAccount hash

Every user is identified on-chain by the **keccak256 hash of their XRPL address** (UTF-8 encoded):

```typescript
xrplAccount = keccak256(utf8("r4obbPExFxVcmqUBr5jepsdtDLX3htdq48"))
// → 0x09114758ebe00573309e1a7c06a2414665e512c25ce274e17d28c63e726a9889
```

This hash is used for: nonce storage, proxy lookup, and signature verification.

### XRPLUserProxy

Each XRPL user gets a dedicated `XRPLUserProxy` contract deployed on XRPL EVM.
It acts as their on-chain account — all supplied/borrowed balances are held here.

```typescript
proxyAddress = factory.proxyOf(xrplAccount)
// → 0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86
```

### Session key

The **session key** is an EVM private key. Its corresponding address must be registered
in the adapter for the XRPL user via `setIntentSigner`. Every intent envelope is signed
with this key — the adapter verifies the signature before executing any action.

### Nonce

The adapter maintains a per-user nonce (`nextNonceByXrplAccount`). Each executed intent
increments it by 1. The script reads the nonce fresh before each step and embeds it in
the intent envelope. If the nonce is wrong, the adapter reverts with `InvalidNonce`.

### Drops ↔ EVM wei conversion

```
1 XRP = 1,000,000 drops  (XRPL — 6 decimals)
1 XRP = 1,000,000,000,000,000,000 wei  (EVM — 18 decimals)

conversion: evmWei = drops × 10^12
```

---

## The Intent Envelope

Every action is described by an `IntentEnvelope` struct:

```solidity
struct IntentEnvelope {
    bytes32  intentId;           // unique per intent — prevents replay across chains
    bytes32  xrplAccount;        // keccak256(utf8(xrplAddress))
    address  market;             // cToken address (e.g. sXRP)
    address  underlying;         // underlying token (0xEeee...EeE for native XRP)
    uint8    actionType;         // see action types below
    uint256  amount;             // 18-decimal EVM amount (drops × 10^12 for XRP)
    uint64   nonce;              // monotonically increasing per xrplAccount
    uint64   deadline;           // 0 = no expiry
    bytes    destinationAddress; // utf8(xrplAddress) for BORROW/WITHDRAW, else 0x
    uint16   version;            // always 1
}
```

### Action types

| Value | Name | Description |
|---|---|---|
| 0 | SUPPLY | Deposit XRP into the lending pool |
| 1 | BORROW | Borrow XRP from the pool (returned to XRPL) |
| 2 | REPAY | Repay outstanding borrow |
| 3 | WITHDRAW | Withdraw supplied XRP (returned to XRPL) |
| 4 | ENTER_MARKET | Enable supplied XRP as collateral |
| 5 | EXIT_MARKET | Remove XRP from collateral set |

---

## Signing Scheme

```
payloadHash = keccak256(abi.encode(
    intentId, xrplAccount, market, underlying,
    actionType, amount, nonce, deadline,
    destinationAddress, version
))

digest = keccak256(abi.encode(adapterAddress, chainId, payloadHash))

signature = ECDSA.sign(sessionKey, digest)
```

The `digest` binds the signature to a specific adapter address and chain ID,
preventing a valid signature from being replayed on a different deployment.

The final payload sent in the XRPL memo is:

```typescript
payload = abi.encode(
    tuple(IntentEnvelope, bytes signature)
)
```

---

## Step 0 — Register Session Key *(once per user)*

Before any lending action can be executed, the Securd backend must register the user's
session key in the adapter. This is an EVM transaction called by the Securd admin — **not**
an XRPL Payment.

**When to call:** Once when the user first connects their XRPL wallet to Securd.

### On-chain call

```solidity
// Contract : XRPLSecurdBridgeAdapter
// Caller   : Securd admin (0x243CD17C18052dD49B803dB5be3c2907DA6ff783)
// Function : setIntentSigner

adapter.setIntentSigner(
    bytes32 xrplAccount,  // keccak256(utf8("r4obbPEx..."))
    address signer        // session key EVM address
)
```

### TypeScript

```typescript
const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplAddress));
const tx = await adapter.setIntentSigner(xrplAccount, sessionKeyAddress);
await tx.wait();
```

### Verification

```typescript
const registered = await adapter.intentSignerOfXrplAccount(xrplAccount);
// must equal sessionKeyAddress
```

---

## Step 1 — SUPPLY

**Transport:** ITS `interchain_transfer`
**What happens:** XRP drops are bridged from XRPL to XRPL EVM. The adapter receives them
via `executeWithInterchainToken()` and calls `mint()` on the sXRP cToken. The user's proxy
receives sXRP cTokens representing their deposit.

### XRPL Payment

```json
{
  "TransactionType": "Payment",
  "Account":     "<user XRPL address>",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Amount":      "10000000",
  "Memos": [
    { "Memo": { "MemoType": "74797065",            "MemoData": "696e746572636861696e5f7472616e73666572" } },
    { "Memo": { "MemoType": "64657374696e6174696f6e5f61646472657373", "MemoData": "374143384466383534343830333763366665314544353733326336636137313036303036393233370" } },
    { "Memo": { "MemoType": "64657374696e6174696f6e5f636861696e",    "MemoData": "7872706c2d65766d" } },
    { "Memo": { "MemoType": "6761735f6665655f616d6f756e74",          "MemoData": "30" } },
    { "Memo": { "MemoType": "7061796c6f6164",                        "MemoData": "<ABI-encoded SignedIntent>" } }
  ]
}
```

| Field | Value | Notes |
|---|---|---|
| `Amount` | `"10000000"` drops | 10 XRP — this is the amount being bridged |
| `type` memo | `interchain_transfer` | tells Axelar this is an ITS token transfer |
| `destination_address` | adapter address (no `0x`) | where the adapter is on XRPL EVM |
| `destination_chain` | `xrpl-evm` | target chain name |
| `gas_fee_amount` | `"0"` | **zero for native XRP** — gas is handled separately by ITS |
| `payload` | ABI-encoded `SignedIntent` | raw hex, not UTF-8 encoded |

### Intent envelope

```
intentId           = keccak256("xrp-supply:<xrplAddress>:<nonce>:<timestamp>")
xrplAccount        = 0x09114758ebe00573309e1a7c06a2414665e512c25ce274e17d28c63e726a9889
market             = 0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318
underlying         = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
actionType         = 0  (SUPPLY)
amount             = 10000000000000000000  (10,000,000 drops × 10^12)
nonce              = <current adapter nonce>
deadline           = 0
destinationAddress = 0x
version            = 1
```

### After confirmation

```typescript
const supplied = await sXRP.balanceOfUnderlying.staticCall(proxyAddress);
// → 10.0 XRP (or more if prior deposits exist)
```

---

## Step 2 — ENTER_MARKET

**Transport:** GMP `call_contract`
**What happens:** No tokens move. The adapter calls `comptroller.enterMarkets([sXRP])` through
the proxy, enabling the user's sXRP balance to count as collateral for borrowing.
**Required before:** BORROW.

### XRPL Payment

```json
{
  "TransactionType": "Payment",
  "Account":     "<user XRPL address>",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Amount":      "3000000",
  "Memos": [
    { "Memo": { "MemoType": "74797065",            "MemoData": "63616c6c5f636f6e7472616374" } },
    { "Memo": { "MemoType": "64657374696e6174696f6e5f61646472657373", "MemoData": "<adapter addr hex>" } },
    { "Memo": { "MemoType": "64657374696e6174696f6e5f636861696e",    "MemoData": "7872706c2d65766d" } },
    { "Memo": { "MemoType": "7061796c6f6164",                        "MemoData": "<ABI-encoded SignedIntent>" } }
  ]
}
```

| Field | Value | Notes |
|---|---|---|
| `Amount` | `"3000000"` drops | 3 XRP — Axelar relay gas fee |
| `type` memo | `call_contract` | instruction-only, no token bridge |
| no `gas_fee_amount` memo | — | not needed for `call_contract` |

### Intent envelope

```
actionType         = 4  (ENTER_MARKET)
amount             = 0
nonce              = <previous nonce + 1>
destinationAddress = 0x
```

---

## Step 3 — BORROW

**Transport:** GMP `call_contract`
**What happens:** No tokens come from XRPL. The adapter calls `borrow()` on the sXRP cToken
through the proxy, then bridges the borrowed XRP back to the user's XRPL address using ITS
egress (`interchainTransfer` from XRPL EVM → XRPL). The `egressGasValue` (1 XRP) is taken
from the adapter's balance to pay for the outbound ITS call.

### XRPL Payment

Same structure as ENTER_MARKET (`call_contract`) with 3 XRP gas.

### Intent envelope

```
actionType         = 1  (BORROW)
amount             = 1000000000000000000  (1 XRP in EVM wei)
nonce              = <previous nonce + 1>
destinationAddress = utf8("r4obbPExFxVcmqUBr5jepsdtDLX3htdq48")
                     ↑ the XRPL address where borrowed XRP is sent back
```

> **destinationAddress** must be the UTF-8 bytes of the XRPL address, **not** a hex EVM address.

### After confirmation

```typescript
const borrowed = await sXRP.borrowBalanceCurrent.staticCall(proxyAddress);
// → 1.0 XRP
// The 1 XRP will arrive at the user's XRPL address via Axelar ITS (separate tx)
```

---

## Step 4 — REPAY

**Transport:** ITS `interchain_transfer`
**What happens:** XRP flows XRPL → XRPL EVM (same as SUPPLY). The adapter calls
`repayBorrow()` on the sXRP cToken instead of `mint()`.

> **Critical:** Compound V2 reverts if `repayAmount > outstanding borrow`.
> Always read `borrowBalanceCurrent` on-chain just before sending and use that
> exact amount (ceiled to nearest drop to account for interest accrual).

### Computing the repay amount

```typescript
// Read live borrow balance (accrues per block — read as close to send time as possible)
const borrowBalEVM = await sXRP.borrowBalanceCurrent.staticCall(proxyAddress);

// Convert EVM wei → drops, ceiling to avoid under-repay
const repayDrops = (borrowBalEVM + 10n**12n - 1n) / 10n**12n;

// Total XRPL Payment = repay + gas fee
const totalDrops = repayDrops + 2_000_000n;  // 2 XRP gas fee
```

### XRPL Payment

```json
{
  "Amount": "<repayDrops + 2000000>",
  "Memos": [
    { "type":               "interchain_transfer" },
    { "destination_chain":  "xrpl-evm" },
    { "destination_address": "<adapter addr>" },
    { "gas_fee_amount":     "2000000" },
    { "payload":            "<ABI-encoded SignedIntent>" }
  ]
}
```

| Field | Value | Notes |
|---|---|---|
| `Amount` | `repayDrops + 2000000` | repay amount plus Axelar gas |
| `gas_fee_amount` | `"2000000"` | Axelar deducts this; net bridged = `repayDrops` |

### Intent envelope

```
actionType         = 2  (REPAY)
amount             = repayDrops × 10^12   (exact repay in EVM wei)
nonce              = <previous nonce + 1>
destinationAddress = 0x
```

---

## Step 5 — EXIT_MARKET

**Transport:** GMP `call_contract`
**What happens:** No tokens move. The adapter calls `comptroller.exitMarket(sXRP)` through
the proxy, removing sXRP from the collateral set. The Comptroller will revert if removing
this market would leave active borrows undercollateralized.

**Precondition:** Outstanding borrow must be fully repaid first.

### XRPL Payment

Same structure as ENTER_MARKET — `call_contract` with 3 XRP gas.

### Intent envelope

```
actionType         = 5  (EXIT_MARKET)
amount             = 0
nonce              = <previous nonce + 1>
```

---

## Step 6 — WITHDRAW

**Transport:** GMP `call_contract`
**What happens:** No tokens come from XRPL. The adapter calls `redeemUnderlying()` on the
sXRP cToken (burns cTokens, releases underlying XRP), then bridges the XRP back to the
user's XRPL address via ITS egress.

### XRPL Payment

Same structure as BORROW — `call_contract` with 3 XRP gas.

### Intent envelope

```
actionType         = 3  (WITHDRAW)
amount             = 10000000000000000000  (10 XRP in EVM wei)
nonce              = <previous nonce + 1>
destinationAddress = utf8("r4obbPExFxVcmqUBr5jepsdtDLX3htdq48")
                     ↑ the XRPL address where withdrawn XRP is sent back
```

---

## Full Nonce Sequence

Starting from nonce N:

| Step | Action | Nonce consumed | Nonce after |
|---|---|---|---|
| 0 | `setIntentSigner` (EVM tx) | — | N |
| 1 | SUPPLY | N | N+1 |
| 2 | ENTER_MARKET | N+1 | N+2 |
| 3 | BORROW | N+2 | N+3 |
| 4 | REPAY | N+3 | N+4 |
| 5 | EXIT_MARKET | N+4 | N+5 |
| 6 | WITHDRAW | N+5 | N+6 |

---

## Summary Table

| Step | Action | XRPL memo type | XRPL Amount | actionType | amount (EVM) | destinationAddress |
|---|---|---|---|---|---|---|
| 0 | setIntentSigner | EVM tx (no XRPL Payment) | — | — | — | — |
| 1 | SUPPLY | `interchain_transfer` | supply drops | 0 | drops × 10^12 | `0x` |
| 2 | ENTER_MARKET | `call_contract` | 3 XRP gas | 4 | 0 | `0x` |
| 3 | BORROW | `call_contract` | 3 XRP gas | 1 | borrow wei | utf8(xrplAddr) |
| 4 | REPAY | `interchain_transfer` | repay drops + 2 XRP gas | 2 | repay wei | `0x` |
| 5 | EXIT_MARKET | `call_contract` | 3 XRP gas | 5 | 0 | `0x` |
| 6 | WITHDRAW | `call_contract` | 3 XRP gas | 3 | withdraw wei | utf8(xrplAddr) |

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `IntentSignerNotConfigured` | Step 0 not done — no session key registered | Run `setIntentSigner` first |
| `InvalidNonce(provided, expected)` | Signed intent has wrong nonce | Read `nextNonceByXrplAccount` fresh before signing |
| `InvalidIntentSignature` | Signed with wrong key or wrong domain | Verify session key matches registered address; verify adapterAddr + chainId in digest |
| Compound revert on REPAY | `repayAmount > outstanding` | Read `borrowBalanceCurrent` at send time; use exact amount |
| Compound revert on EXIT_MARKET | Outstanding borrow still active | Repay all borrows first |
| Relay timeout | Axelar relay slow (testnet) | Increase `XRPL_RELAY_TIMEOUT_SEC`; reuse nonce only if relay never reached EVM |
| `gas_fee_amount` wrong for ITS | Sending 0 gas for ERC-20 IOU tokens | Use `"0"` only for native XRP; for ERC-20 tokens set actual gas drops |

---

## Running the Script

```bash
# Dry run — shows full plan without submitting
XRPL_BRIDGE_ADAPTER=0x7AC8Df85448037c6fE1eD5732c6ca71060069237 \
XRPL_DEPOSIT_MARKET=0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318 \
XRPL_DEPOSIT_UNDERLYING=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE \
npx hardhat run scripts/runXrplLendingFlow.ts --network xrplEvm

# Live run — submit all 6 transactions
XRPL_CONFIRM_SEND=true \
XRPL_RELAY_TIMEOUT_SEC=600 \
... npx hardhat run scripts/runXrplLendingFlow.ts --network xrplEvm

# Resume from a specific step (e.g. after SUPPLY already confirmed)
XRPL_START_FROM_STEP=3 \
XRPL_CONFIRM_SEND=true \
... npx hardhat run scripts/runXrplLendingFlow.ts --network xrplEvm
```

### Required environment variables

| Variable | Description | Example |
|---|---|---|
| `XRPL_SEED` | XRPL wallet seed | `sXXX...` |
| `XRPL_EVM_RPC_URL` | XRPL EVM JSON-RPC endpoint | `https://rpc-evm-sidechain.xrpl.org` |
| `DEPLOYER_PRIVATE_KEY` | EVM private key (session key + admin) | `0xabc...` |
| `XRPL_BRIDGE_ADAPTER` | Adapter contract address | `0x7AC8...` |
| `XRPL_DEPOSIT_MARKET` | sXRP cToken address | `0x6ec5...` |
| `XRPL_DEPOSIT_UNDERLYING` | Underlying token address | `0xEeee...EeE` |

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `XRPL_RPC_URL` | `wss://s.altnet.rippletest.net:51233` | XRPL WebSocket endpoint |
| `XRPL_AXELAR_GATEWAY` | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` | Axelar gateway XRPL address |
| `XRPL_EVM_AXELAR_CHAIN` | `xrpl-evm` | Axelar destination chain name |
| `XRPL_GMP_GAS_DROPS` | `3000000` | Gas drops for GMP steps (3 XRP) |
| `XRPL_REPAY_GAS_FEE_DROPS` | `2000000` | Gas drops for REPAY ITS step (2 XRP) |
| `XRPL_RELAY_TIMEOUT_SEC` | `120` | Seconds to wait per relay confirmation |
| `XRPL_START_FROM_STEP` | `1` | Skip steps before this number (1–6) |
| `XRPL_CONFIRM_SEND` | (unset = dry run) | Set to `"true"` to submit live transactions |
