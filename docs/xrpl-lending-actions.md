# Securd — Complete Guide to All Lending Actions from XRPL Ledger

## Overview

Every lending action (SUPPLY, WITHDRAW, ENTER_MARKET, EXIT_MARKET, BORROW, REPAY) follows the
same pattern:

```
User (XRPL Ledger)
  → Payment to Axelar gateway
    → Axelar relayer picks up the transaction
      → XRPLSecurdBridgeAdapter.execute() on XRPL EVM
        → XRPLUserProxy.execute() on behalf of the user
          → Compound V2 cToken action
```

The key distinction is **how XRP or tokens are transported**:

| Transport | Used for | XRPL memo `type` |
|---|---|---|
| **ITS interchain_transfer** | Actions that move tokens inbound (SUPPLY, REPAY) | `interchain_transfer` |
| **GMP call_contract** | Actions that are instruction-only or move tokens outbound (ENTER_MARKET, EXIT_MARKET, BORROW, WITHDRAW) | `call_contract` |

---

## Part 1 — One-Time User Registration (Option B)

Before any action can be executed, the Securd backend must register the user's XRPL address
in the adapter. This is done **once per user**, not per transaction.

### What it does

Maps the user's XRPL account hash to the backend signer address so the adapter can verify
intent signatures for all future transactions from that user.

### On-chain call

```solidity
// Adapter: XRPLSecurdBridgeAdapter
// Caller:  Securd admin (0x243CD17C18052dD49B803dB5be3c2907DA6ff783)
// Called:  once when user first connects their XRPL wallet

adapter.setIntentSigner(
    bytes32 xrplAccount,  // keccak256(utf8(xrplAddress))
    address signer        // backend signer key (same for all users in Option B)
)
```

### TypeScript example

```typescript
import { ethers } from "ethers"

const ADAPTER_ABI = [
  "function setIntentSigner(bytes32 xrplAccount, address signer) external",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
]

const provider = new ethers.JsonRpcProvider(XRPL_EVM_RPC_URL)
const admin    = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider)
const adapter  = new ethers.Contract(ADAPTER_ADDRESS, ADAPTER_ABI, admin)

const userXrplAddress = "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48"
const xrplAccount     = ethers.keccak256(ethers.toUtf8Bytes(userXrplAddress))
const backendSigner   = "0x243CD17C18052dD49B803dB5be3c2907DA6ff783"

const tx = await adapter.setIntentSigner(xrplAccount, backendSigner)
await tx.wait()

// Verify
const registered = await adapter.intentSignerOfXrplAccount(xrplAccount)
console.log("Registered signer:", registered)
// → 0x243CD17C18052dD49B803dB5be3c2907DA6ff783
```

**After this call:** every lending action from `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48` will be
accepted by the adapter as long as the intent is signed by `0x243CD...`.

---

## Part 2 — The Intent Envelope

Every action includes a signed **IntentEnvelope** encoded in the XRPL transaction memo `payload`.
The envelope is the same structure for all 6 actions — only `actionType`, `amount`, and
`destinationAddress` change.

### Envelope fields

```typescript
interface IntentEnvelope {
  intentId:           bytes32   // unique ID — keccak256 of a descriptive string
  xrplAccount:        bytes32   // keccak256(utf8(xrplAddress))
  market:             address   // cToken address (sXRP or sSTST)
  underlying:         address   // underlying token address
  actionType:         uint8     // 0=SUPPLY 1=BORROW 2=REPAY 3=WITHDRAW 4=ENTER_MARKET 5=EXIT_MARKET
  amount:             uint256   // 18-decimal EVM amount (0 for ENTER/EXIT_MARKET)
  nonce:              uint64    // must equal adapter.nextNonceByXrplAccount(xrplAccount)
  deadline:           uint64    // Unix timestamp (0 = no deadline)
  destinationAddress: bytes     // XRPL address bytes for egress actions (BORROW, WITHDRAW); 0x for others
  version:            uint16    // always 1
}
```

### How the intent is signed

```typescript
// 1. ABI-encode the envelope fields
const payloadHash = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32","bytes32","address","address","uint8","uint256","uint64","uint64","bytes","uint16"],
    [intentId, xrplAccount, market, underlying, actionType, amount, nonce, deadline, destinationAddress, version]
  )
)

// 2. Domain-bind: adapter address + chain ID prevent replay across contracts/chains
const digest = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "bytes32"],
    [adapterAddress, chainId, payloadHash]
  )
)

// 3. Sign with backend key (same key registered via setIntentSigner)
const signature = await backendSigner.signMessage(ethers.getBytes(digest))
```

### How it is ABI-encoded into the payload memo

```typescript
const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)"

const payload = ethers.AbiCoder.defaultAbiCoder().encode(
  [SIGNED_INTENT_TUPLE],
  [[[intentId, xrplAccount, market, underlying, actionType, amount,
     nonce, deadline, destinationAddress, version],
    signature]]
)
```

---

## Part 3 — Action-by-Action Reference

### Contract Addresses (XRPL EVM Testnet)

| Contract | Address |
|---|---|
| XRPLSecurdBridgeAdapter | `0x7AC8Df85448037c6fE1eD5732c6ca71060069237` |
| sXRP cToken | `0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318` |
| sSTST cToken | `0x2F874D87E685EC28be749B781dc99119F27CF0be` |
| XRP underlying | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |
| STST underlying | `0x075cEB633c10B74Ed678D1623746bddff6b98517` |
| Axelar gateway (XRPL) | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |

---

### Action 1 — SUPPLY (actionType = 0)

**What it does:** sends XRP (or STST) from XRPL Ledger to the adapter, which calls
`mint(amount)` on the cToken via the user proxy. The user receives cTokens in their proxy.

**Transport:** ITS `interchain_transfer` — tokens are bridged inbound.

**Amount in envelope:** the deposit amount in 18-decimal EVM wei.

**XRP unit conversion:** XRPL uses drops (6 decimals). EVM uses 18 decimals.
```
depositAmountEVM = depositAmountDrops × 10^12
```

**XRPL Payment (XRP market):**
```json
{
  "TransactionType": "Payment",
  "Account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "Amount": "13000000",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Memos": [
    { "Memo": { "MemoType": "74797065",             "MemoData": "696e74657263..."  }},
    { "Memo": { "MemoType": "64657374696e...",       "MemoData": "3741433844..."   }},
    { "Memo": { "MemoType": "64657374696e...(chain)","MemoData": "7872706c2d65766d"}},
    { "Memo": { "MemoType": "6761735f6665...",       "MemoData": "30"             }},
    { "Memo": { "MemoType": "7061796c6f6164",        "MemoData": "<ABI payload>"  }}
  ]
}
```

Decoded memos:

| Key | Value | Meaning |
|---|---|---|
| `type` | `interchain_transfer` | ITS bridge |
| `destination_address` | `7AC8Df85...` (adapter address) | Receiver on XRPL EVM |
| `destination_chain` | `xrpl-evm` | Target chain |
| `gas_fee_amount` | `0` (drops) | Gas taken from Amount (0 for XRP native) |
| `payload` | `<ABI bytes>` | Signed IntentEnvelope |

`Amount` field = deposit drops + gas fee drops. For XRP native, gas_fee_amount is 0.

**Envelope values:**
```
actionType         = 0  (SUPPLY)
amount             = depositAmountDrops × 10^12
destinationAddress = 0x  (no egress needed)
```

**TypeScript example:**
```typescript
const depositDrops    = 10_000_000n               // 10 XRP
const gasFeeDrops     = 0n
const totalDrops      = depositDrops + gasFeeDrops
const depositAmountEVM = depositDrops * BigInt(1e12) // → 10_000_000_000_000_000_000n

const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`supply:${xrplAddress}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplAddress)),
  market:             "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",  // sXRP
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         0,
  amount:             depositAmountEVM,
  nonce:              nonce,
  deadline:           0n,
  destinationAddress: "0x",
  version:            1
}
```

**STST market difference:**
For IOU tokens the Amount field uses the IOU object format, and gas is taken from the IOU itself:
```json
"Amount": {
  "currency": "5354535400000000000000000000000000000000",
  "issuer":   "<STST issuer>",
  "value":    "12"
}
```
Where `value = supplyAmount + gasFeeToken` (e.g. 10 STST supply + 2 STST gas = "12").
`gas_fee_amount` memo = `"2"` (gas portion in IOU units).

---

### Action 2 — ENTER_MARKET (actionType = 4)

**What it does:** calls `comptroller.enterMarkets([market])` via the user proxy, enabling the
supplied cToken balance to count as collateral for borrowing.

**Must be done before BORROW.** Cannot borrow against a market that has not been entered.

**Transport:** GMP `call_contract` — no tokens move inbound, only an instruction.

**XRPL Payment:**
```json
{
  "TransactionType": "Payment",
  "Account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "Amount": "3000000",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Memos": [
    { "Memo": { "MemoType": "type",                "MemoData": "call_contract" }},
    { "Memo": { "MemoType": "destination_address", "MemoData": "<adapter addr>" }},
    { "Memo": { "MemoType": "destination_chain",   "MemoData": "xrpl-evm" }},
    { "Memo": { "MemoType": "payload",             "MemoData": "<ABI payload>" }}
  ]
}
```

`Amount` = GMP gas only (3,000,000 drops = 3 XRP). No `gas_fee_amount` memo for `call_contract`.

**Envelope values:**
```
actionType         = 4  (ENTER_MARKET)
amount             = 0
destinationAddress = 0x
```

**TypeScript example:**
```typescript
const gasDrops = 3_000_000n  // 3 XRP for Axelar GMP relay

const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`enter-market:${xrplAddress}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplAddress)),
  market:             "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",  // sXRP
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         4,
  amount:             0n,
  nonce:              nonce,
  deadline:           0n,
  destinationAddress: "0x",
  version:            1
}
```

---

### Action 3 — BORROW (actionType = 1)

**What it does:** calls `borrow(amount)` on the cToken via the user proxy. The borrowed tokens
are transferred from the adapter to the user's XRPL address via ITS egress.

**Prerequisite:** user must have entered the market (ENTER_MARKET) and have sufficient collateral.

**Transport:** GMP `call_contract` — the instruction travels inbound via GMP; the tokens travel
outbound via ITS egress triggered by the adapter.

**XRPL Payment:**
```json
{
  "TransactionType": "Payment",
  "Account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "Amount": "3000000",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Memos": [
    { "Memo": { "MemoType": "type",                "MemoData": "call_contract" }},
    { "Memo": { "MemoType": "destination_address", "MemoData": "<adapter addr>" }},
    { "Memo": { "MemoType": "destination_chain",   "MemoData": "xrpl-evm" }},
    { "Memo": { "MemoType": "payload",             "MemoData": "<ABI payload>" }}
  ]
}
```

`Amount` = GMP gas only (3,000,000 drops). Borrowed tokens arrive on XRPL via ITS after execution.

**Envelope values:**
```
actionType         = 1  (BORROW)
amount             = borrowAmountEVM  (18-decimal)
destinationAddress = ethers.hexlify(ethers.toUtf8Bytes(xrplAddress))
                     ↑ this tells the adapter where to send the borrowed tokens on XRPL
```

**TypeScript example:**
```typescript
const borrowXRP       = "1"
const borrowAmountEVM = ethers.parseEther(borrowXRP)   // 1 XRP → 1_000_000_000_000_000_000n
const gasDrops        = 3_000_000n

// destinationAddress: where borrowed tokens land on XRPL (UTF-8 encoded r-address)
const destinationAddress = ethers.hexlify(ethers.toUtf8Bytes(xrplAddress))

const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`borrow:${xrplAddress}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplAddress)),
  market:             "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         1,
  amount:             borrowAmountEVM,
  nonce:              nonce,
  deadline:           0n,
  destinationAddress: destinationAddress,
  version:            1
}
```

**Important:** `borrowAmount` must not exceed the user's borrowing capacity:
```
maxBorrow = sum(suppliedUSD × collateralFactor) − currentBorrowsUSD
```

---

### Action 4 — REPAY (actionType = 2)

**What it does:** sends XRP (or STST) back through the bridge; the adapter calls
`repayBorrow(amount)` on the cToken via the user proxy.

**Transport:** ITS `interchain_transfer` — tokens move inbound (same as SUPPLY).

**XRPL Payment (XRP market):**
```json
{
  "TransactionType": "Payment",
  "Account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "Amount": "3000000",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Memos": [
    { "Memo": { "MemoType": "type",                "MemoData": "interchain_transfer" }},
    { "Memo": { "MemoType": "destination_address", "MemoData": "<adapter addr>" }},
    { "Memo": { "MemoType": "destination_chain",   "MemoData": "xrpl-evm" }},
    { "Memo": { "MemoType": "gas_fee_amount",      "MemoData": "2000000" }},
    { "Memo": { "MemoType": "payload",             "MemoData": "<ABI payload>" }}
  ]
}
```

`Amount` = repayDrops + gasFeeDrops.
`gas_fee_amount` = gasFeeDrops (2,000,000 drops = 2 XRP for relay).
Net repay = Amount − gas_fee_amount.

**Envelope values:**
```
actionType         = 2  (REPAY)
amount             = repayAmountDrops × 10^12
destinationAddress = 0x  (no egress — repay never sends tokens back)
```

**TypeScript example:**
```typescript
const repayDrops      = 1_000_000n   // 1 XRP
const gasFeeDrops     = 2_000_000n   // 2 XRP relay gas
const totalDrops      = repayDrops + gasFeeDrops  // 3,000,000 drops sent
const repayAmountEVM  = repayDrops * BigInt(1e12) // → 1_000_000_000_000_000_000n

const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`repay:${xrplAddress}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplAddress)),
  market:             "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         2,
  amount:             repayAmountEVM,
  nonce:              nonce,
  deadline:           0n,
  destinationAddress: "0x",
  version:            1
}
```

**Critical rule:** `repayAmount` must NOT exceed current borrow balance. Compound V2 reverts if
you try to over-repay. Always read current borrow balance first:

```typescript
const CTOKEN_ABI = ["function borrowBalanceCurrent(address) returns (uint256)"]
const cToken     = new ethers.Contract(SXRP_ADDRESS, CTOKEN_ABI, provider)
const borrowed   = await cToken.borrowBalanceCurrent.staticCall(proxyAddress)
// repayAmountEVM must be ≤ borrowed
```

**STST market difference:**
Amount is an IOU object. repayTotal = repayAmount + gasFeeToken (gas taken from IOU).
```json
"Amount": { "currency": "...", "issuer": "...", "value": "3" }
// where 3 = 1 STST repay + 2 STST gas
```
`gas_fee_amount` memo = `"2"`.

---

### Action 5 — EXIT_MARKET (actionType = 5)

**What it does:** calls `comptroller.exitMarket(market)` via the user proxy, removing the cToken
balance from collateral. After this, the supplied tokens no longer back any borrows.

**Prerequisite:** user must have no open borrow in this market. The comptroller will revert
if exit would leave existing borrows under-collateralised.

**Transport:** GMP `call_contract`.

**XRPL Payment:**
```json
{
  "TransactionType": "Payment",
  "Account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "Amount": "3000000",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Memos": [
    { "Memo": { "MemoType": "type",                "MemoData": "call_contract" }},
    { "Memo": { "MemoType": "destination_address", "MemoData": "<adapter addr>" }},
    { "Memo": { "MemoType": "destination_chain",   "MemoData": "xrpl-evm" }},
    { "Memo": { "MemoType": "payload",             "MemoData": "<ABI payload>" }}
  ]
}
```

**Envelope values:**
```
actionType         = 5  (EXIT_MARKET)
amount             = 0
destinationAddress = 0x
```

**TypeScript example:**
```typescript
const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`exit-market:${xrplAddress}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplAddress)),
  market:             "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         5,
  amount:             0n,
  nonce:              nonce,
  deadline:           0n,
  destinationAddress: "0x",
  version:            1
}
```

---

### Action 6 — WITHDRAW (actionType = 3)

**What it does:** calls `redeemUnderlying(amount)` on the cToken via the user proxy. The
redeemed tokens are transferred back to the user's XRPL address via ITS egress.

**Prerequisite:** user must have exited the market (EXIT_MARKET) if they want to withdraw all.
If still in the market, the comptroller will block withdrawal if it would leave borrows
under-collateralised.

**Transport:** GMP `call_contract` — instruction inbound, tokens outbound via ITS egress.

**XRPL Payment:**
```json
{
  "TransactionType": "Payment",
  "Account": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48",
  "Amount": "3000000",
  "Destination": "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  "Memos": [
    { "Memo": { "MemoType": "type",                "MemoData": "call_contract" }},
    { "Memo": { "MemoType": "destination_address", "MemoData": "<adapter addr>" }},
    { "Memo": { "MemoType": "destination_chain",   "MemoData": "xrpl-evm" }},
    { "Memo": { "MemoType": "payload",             "MemoData": "<ABI payload>" }}
  ]
}
```

`Amount` = GMP gas only (3,000,000 drops). Withdrawn tokens arrive on XRPL via ITS after execution.

**Envelope values:**
```
actionType         = 3  (WITHDRAW)
amount             = withdrawAmountEVM  (18-decimal)
destinationAddress = ethers.hexlify(ethers.toUtf8Bytes(xrplAddress))
                     ↑ where to send the withdrawn tokens on XRPL
```

**TypeScript example:**
```typescript
const withdrawXRP       = "5"
const withdrawAmountEVM = ethers.parseEther(withdrawXRP)   // → 5_000_000_000_000_000_000n
const gasDrops          = 3_000_000n

const destinationAddress = ethers.hexlify(ethers.toUtf8Bytes(xrplAddress))

const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`withdraw:${xrplAddress}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplAddress)),
  market:             "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         3,
  amount:             withdrawAmountEVM,
  nonce:              nonce,
  deadline:           0n,
  destinationAddress: destinationAddress,
  version:            1
}
```

---

## Part 4 — Full Flow Example

A user supplies 10 XRP, borrows 1 XRP, then repays and withdraws.

```
Step 1  SUPPLY        nonce=0   interchain_transfer  10 XRP + 0 gas   → mint cTokens in proxy
Step 2  ENTER_MARKET  nonce=1   call_contract        3 XRP gas only   → enable collateral
Step 3  BORROW        nonce=2   call_contract        3 XRP gas only   → receive 1 XRP on XRPL
Step 4  REPAY         nonce=3   interchain_transfer  1 XRP + 2 gas    → clear borrow debt
Step 5  EXIT_MARKET   nonce=4   call_contract        3 XRP gas only   → disable collateral
Step 6  WITHDRAW      nonce=5   call_contract        3 XRP gas only   → receive 10 XRP on XRPL
```

Each step must complete (Axelar relay confirmed, adapter nonce advances) before the next step
can be submitted. The nonce is strictly sequential — submitting nonce=2 while nonce=1 is still
pending will be rejected.

### Nonce management

```typescript
// Always fetch the current nonce from the adapter before building an intent
const nonce = await adapter.nextNonceByXrplAccount(xrplAccount)
// → advances by 1 after each successfully executed intent
```

---

## Part 5 — Action Reference Summary

| Action | Type | actionType | Transport | Amount field | destinationAddress | Gas (drops) |
|---|---|---|---|---|---|---|
| SUPPLY | token inbound | 0 | interchain_transfer | depositDrops × 10^12 | `0x` | 0 (XRP) / IOU (STST) |
| ENTER_MARKET | instruction | 4 | call_contract | 0 | `0x` | 3,000,000 |
| BORROW | instruction + egress | 1 | call_contract | borrowEVM (18-dec) | UTF-8 XRPL address | 3,000,000 |
| REPAY | token inbound | 2 | interchain_transfer | repayDrops × 10^12 | `0x` | 2,000,000 (XRP) |
| EXIT_MARKET | instruction | 5 | call_contract | 0 | `0x` | 3,000,000 |
| WITHDRAW | instruction + egress | 3 | call_contract | withdrawEVM (18-dec) | UTF-8 XRPL address | 3,000,000 |

---

## Part 6 — Common Errors and Causes

| Error | Root cause | Fix |
|---|---|---|
| `IntentSignerNotConfigured` | User was never registered via `setIntentSigner` | Admin calls `setIntentSigner` for this user |
| `InvalidNonce` | Submitted nonce doesn't match `nextNonceByXrplAccount` | Fetch nonce fresh from adapter before building intent |
| `InvalidSignature` | Intent signed by wrong key OR domain binding wrong | Verify signer matches registered signer; verify adapter address and chainId in digest |
| `REPAY_AMOUNT` revert | Repay exceeds current borrow balance | Read `borrowBalanceCurrent.staticCall(proxy)` first; never send more than borrowed |
| `exitMarket` revert | Exit would leave existing borrow under-collateralised | Repay all borrows before exiting the market |
| `redeemUnderlying` revert | Withdraw would leave existing borrow under-collateralised | Exit market first, or ensure enough collateral remains after withdrawal |
| GMP never executed | Insufficient gas drops on XRPL transaction | Increase `XRPL_GMP_GAS_DROPS` (default 3,000,000) |
| ITS never minted | Insufficient gas_fee_amount | Increase `XRPL_REPAY_GAS_FEE_DROPS` / `XRPL_STST_GAS_FEE` |
