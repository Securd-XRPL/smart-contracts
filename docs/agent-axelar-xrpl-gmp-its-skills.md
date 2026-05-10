# Agent Skill: Axelar GMP & ITS Between XRPL Ledger and XRPL EVM

> **Purpose**: Teach an AI agent how to construct, sign, and submit cross-chain messages
> between XRPL Ledger and XRPL EVM using the Axelar protocol.
> All code and addresses have been verified against live testnet deployments.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Network Constants](#2-network-constants)
3. [Core Concepts](#3-core-concepts)
4. [Data Structures](#4-data-structures)
5. [Intent Signing](#5-intent-signing)
6. [Flow 1 — XRPL → XRPL EVM via GMP (call_contract)](#6-flow-1--xrpl--xrpl-evm-via-gmp-call_contract)
7. [Flow 2 — XRPL → XRPL EVM via ITS (interchain_transfer)](#7-flow-2--xrpl--xrpl-evm-via-its-interchain_transfer)
8. [Flow 3 — XRPL EVM → XRPL Ledger via ITS (interchainTransfer)](#8-flow-3--xrpl-evm--xrpl-ledger-via-its-interchaintransfer)
9. [On-Chain Execution Logic](#9-on-chain-execution-logic)
10. [Admin Setup Sequence](#10-admin-setup-sequence)
11. [Complete TypeScript Reference](#11-complete-typescript-reference)
12. [Decision Guide](#12-decision-guide)
13. [Error Reference](#13-error-reference)
14. [Verification Checklist](#14-verification-checklist)

---

## 1. Architecture Overview

```
XRPL Ledger                Axelar Network             XRPL EVM (Chain ID: 1449000)
──────────────             ──────────────             ────────────────────────────
User wallet                Relayer + ITS              XRPLSecurdBridgeAdapter
    │                           │                           │
    │── Payment (GMP) ─────────►│── execute() ────────────►│ validate gateway approval
    │   type=call_contract      │                           │ verify ECDSA signature
    │   payload=SignedIntent     │                           │ run WITHDRAW or BORROW
    │                           │                           │── ITS.interchainTransfer()──►
    │                           │                           │                             │
    │◄─────────────────────── XRP returned via ITS ─────────────────────────────────────┘
    │
    │── Payment (ITS) ─────────►│── ITS mints XRP ─────────►│ receive XRP
    │   type=interchain_transfer│── executeWithInterchainToken│ verify ECDSA signature
    │   deposit + gas drops     │                           │ run SUPPLY or REPAY
    │                           │                           │ cTokens held in user proxy
```

**Three distinct cross-chain flows:**

| # | Direction | Mechanism | Use Cases |
|---|-----------|-----------|-----------|
| 1 | XRPL → XRPL EVM | GMP `call_contract` | WITHDRAW, BORROW |
| 2 | XRPL → XRPL EVM | ITS `interchain_transfer` | SUPPLY, REPAY |
| 3 | XRPL EVM → XRPL | ITS `interchainTransfer` | Return tokens after WITHDRAW/BORROW |

---

## 2. Network Constants

### XRPL Ledger Testnet
| Name | Value |
|------|-------|
| RPC URL | `wss://s.altnet.rippletest.net:51233` |
| Axelar Gateway account | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |
| Axelar chain name for XRPL EVM | `xrpl-evm` |
| XRPL chain name (as Axelar sees it) | `xrpl` |
| Faucet | https://faucet.altnet.rippletest.net/accounts |
| Explorer | https://testnet.xrpl.org |

### XRPL EVM Testnet
| Name | Value |
|------|-------|
| Chain ID | `1449000` |
| RPC URL | `https://rpc.testnet.xrplevm.org` |
| Axelar Gateway contract | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Axelar ITS contract | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| Native XRP ERC20 precompile | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |
| Explorer | https://explorer.testnet.xrplevm.org |
| Axelarscan | https://testnet.axelarscan.io |

### Deployed Securd Contracts (XRPL EVM Testnet)
| Contract | Address |
|----------|---------|
| Unitroller (Comptroller proxy) | `0x407F204191449281B51fEd22d9C2b8efc5EeBEC2` |
| Oracle | `0xC69912BA8eFb51DB140eA541C46Ea09f39c101D1` |
| XRPLUserProxyFactory | `0x997BED4a9004bEb24447e1dc945c27711E852c1C` |
| XRPLSecurdBridgeAdapter | `0x39CD36305a266E3F9748C182cc16edAc502853b0` |
| sXRP cToken market | `0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6` |
| Underlying (native XRP) | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |

---

## 3. Core Concepts

### 3.1 Amount Scaling (Critical)

XRPL Ledger and XRPL EVM use different decimal precisions for XRP:

| Chain | Unit | Decimals |
|-------|------|----------|
| XRPL Ledger | drops | 6 |
| XRPL EVM (native XRP) | wei | 18 |

**Axelar ITS automatically scales inbound amounts:**
```
EVM wei = drops × 10^12
```

Examples:
- `1_000_000 drops` (1 XRP) → `1_000_000_000_000_000_000 wei` (1e18)
- `5_000_000 drops` (5 XRP) → `5_000_000_000_000_000_000 wei` (5e18)

**Rule**: Always store `amount` in 18-decimal EVM wei in `IntentEnvelope.amount`. The ITS delivers this exact amount on XRPL EVM. If the envelope amount does not match what ITS delivers, the adapter reverts with `AmountMismatch`.

```typescript
const DROPS_TO_EVM_SCALE = BigInt(10 ** 12);
const depositAmountEVM = depositAmountDrops * DROPS_TO_EVM_SCALE;
```

For WITHDRAW (no inbound token transfer), the amount is input as human-readable XRP and parsed to 18-decimal wei directly:
```typescript
const withdrawAmountEVM = ethers.parseEther("2"); // "2" XRP → 2e18 wei
```

### 3.2 Native XRP on XRPL EVM

The native gas token and an ERC20 interface share `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`. They represent the same asset — balances mirror each other. **No WXRP wrapper is needed.**

The Axelar ITS TokenManager (type 4 = MINT_BURN) is the `owner()` of this precompile and is authorized to call `mint(address to, uint256 amount)` on it. When an ITS `interchain_transfer` arrives on XRPL EVM, the ITS mints native XRP directly to the destination address.

### 3.3 Per-User Proxy Pattern

Every XRPL account gets a dedicated EVM proxy wallet deployed via CREATE2 by `XRPLUserProxyFactory`. The proxy:
- Holds cToken balances (lending positions) for that XRPL account
- Only the bridge adapter (`controller`) can call `proxy.execute()`
- Is deployed on first use via `proxyFactory.getOrCreateProxy(xrplAccount)`
- Address is deterministic and can be predicted with `proxyFactory.predictProxy(xrplAccount)`

```typescript
// Get the proxy address for an XRPL account (view — no deployment)
const proxyAddress = await proxyFactory.predictProxy(xrplAccountBytes32);

// Or read if already deployed
const proxyAddress = await proxyFactory.proxyOf(xrplAccountBytes32);
```

### 3.4 XRPL Account → bytes32 Identifier

The bridge uses a `bytes32` identifier for each XRPL account derived as:

```typescript
const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address));
// xrplWallet.address is the XRPL r-address string, e.g. "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
```

This same `xrplAccount` bytes32 is used in the `IntentEnvelope`, in `nextNonceByXrplAccount`, in `intentSignerOfXrplAccount`, and as the key in `proxyFactory.proxyOf`.

### 3.5 Nonce Ordering

Each XRPL account has a monotonically increasing nonce in `adapter.nextNonceByXrplAccount(xrplAccount)`. Every successfully executed intent increments it by 1. The next intent must use exactly the current nonce value or the adapter reverts with `InvalidNonce`.

```typescript
const nonce = BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));
```

---

## 4. Data Structures

### 4.1 ActionType Enum

```solidity
// XRPLSecurdTypes.sol
enum ActionType {
    SUPPLY,   // 0 — deposit tokens into lending market (ITS path)
    BORROW,   // 1 — borrow tokens from lending market (GMP path)
    REPAY,    // 2 — repay borrowed tokens (ITS path)
    WITHDRAW  // 3 — withdraw supplied tokens (GMP path)
}
```

### 4.2 IntentEnvelope Struct

```solidity
struct IntentEnvelope {
    bytes32 intentId;           // unique ID for this intent (random or derived)
    bytes32 xrplAccount;        // keccak256(utf8(xrplRAddress))
    address market;             // cToken market address on XRPL EVM
    address underlying;         // underlying ERC20 address (0xEeee... for XRP)
    uint8   actionType;         // 0=SUPPLY, 1=BORROW, 2=REPAY, 3=WITHDRAW
    uint256 amount;             // 18-decimal EVM wei
    uint64  nonce;              // monotonic, per-XRPL-account
    uint64  deadline;           // unix timestamp, 0 = no expiry
    bytes   destinationAddress; // UTF-8 encoded XRPL r-address (for egress)
    uint16  version;            // always 1 (ENVELOPE_VERSION)
}

struct SignedIntent {
    IntentEnvelope envelope;
    bytes signature;            // ECDSA signature (65 bytes)
}
```

### 4.3 ABI Encoding

The payload sent through Axelar is ABI-encoded `SignedIntent`:

```typescript
const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

function encodeSignedIntent(envelope: IntentEnvelope, signature: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[
      envelope.intentId,
      envelope.xrplAccount,
      envelope.market,
      envelope.underlying,
      envelope.actionType,
      envelope.amount,
      envelope.nonce,
      envelope.deadline,
      envelope.destinationAddress,
      envelope.version
    ], signature]]
  );
}
```

### 4.4 MarketConfig Struct

```solidity
struct MarketConfig {
    address underlying; // ERC20 token address (0xEeee... for XRP)
    bytes32 tokenId;    // Axelar ITS token ID for this asset
    bool    listed;     // false = market is disabled for bridging
}
```

Read from adapter:
```typescript
const cfg = await adapter.marketConfigOf(marketAddress);
// cfg.underlying, cfg.tokenId, cfg.listed
```

---

## 5. Intent Signing

Every cross-chain action is authenticated by an ECDSA signature over the intent envelope. The adapter verifies this on-chain using `intentSignerOfXrplAccount[xrplAccount]`.

### 5.1 Hash Computation

```typescript
// Step 1: hash the envelope fields
function hashEnvelope(envelope: IntentEnvelope): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","bytes32","address","address","uint8","uint256","uint64","uint64","bytes","uint16"],
      [
        envelope.intentId,
        envelope.xrplAccount,
        envelope.market,
        envelope.underlying,
        envelope.actionType,
        envelope.amount,
        envelope.nonce,
        envelope.deadline,
        envelope.destinationAddress,
        envelope.version
      ]
    )
  );
}

// Step 2: build the domain-separated digest
function buildDigest(adapterAddress: string, chainId: bigint, payloadHash: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32"],
      [adapterAddress, chainId, payloadHash]
    )
  );
}
```

### 5.2 Signing

```typescript
const provider  = new ethers.JsonRpcProvider(evmRpcUrl);
const network   = await provider.getNetwork();
const evmSigner = new ethers.Wallet(intentSignerPrivateKey, provider);

const payloadHash = hashEnvelope(envelope);
const digest      = buildDigest(adapterAddress, network.chainId, payloadHash);

// Use signMessage (EIP-191 — adds "\x19Ethereum Signed Message:\n32" prefix)
const signature = await evmSigner.signMessage(ethers.getBytes(digest));
```

**On-chain verification** (from `XRPLSecurdBridgeAdapter._validateIntentSignature`):
```solidity
bytes32 digest = keccak256(abi.encode(address(this), block.chainid, payloadHash));
bytes32 ethSignedDigest = ECDSA.toEthSignedMessageHash(digest);
address recoveredSigner = ECDSA.recover(ethSignedDigest, signature);
if (recoveredSigner != expectedSigner) revert InvalidIntentSignature(...);
```

### 5.3 Signer Registration (Admin Setup)

The intent signer must be pre-registered in the adapter before any intent executes:

```typescript
// Only callable by adapter owner
await adapter.connect(owner).setIntentSigner(xrplAccountBytes32, evmSignerAddress);
```

Verify it is set correctly:
```typescript
const configured = await adapter.intentSignerOfXrplAccount(xrplAccountBytes32);
// must equal evmSigner.address (case-insensitive)
```

### 5.4 IntentId Generation

```typescript
const intentId = ethers.keccak256(
  ethers.toUtf8Bytes(`xrpl-deposit:${xrplWallet.address}:${nonce.toString()}:${Date.now()}`)
);
// or for withdraw:
const intentId = ethers.keccak256(
  ethers.toUtf8Bytes(`xrpl-withdraw:${xrplWallet.address}:${nonce.toString()}:${Date.now()}`)
);
```

`intentId` must be globally unique per adapter. The adapter uses `payloadHashByIntent[intentId]` for idempotency — replaying the same `intentId` with the same payload is silently ignored; replaying with a different payload reverts with `IntentHashConflict`.

---

## 6. Flow 1 — XRPL → XRPL EVM via GMP (`call_contract`)

**Use for**: WITHDRAW (actionType=3) and BORROW (actionType=1)

The XRPL Payment carries **gas XRP only** (no token transfer). The Axelar relayer detects the `call_contract` memo and calls `adapter.execute()` on XRPL EVM.

### 6.1 XRPL Payment Structure

```typescript
import { Client, Payment, Wallet } from "xrpl";

const GMP_GAS_DROPS = 3_000_000n; // 3 XRP for relay gas (sufficient for testnet)

const tx: Payment = {
  TransactionType: "Payment",
  Account:     xrplWallet.address,
  Amount:      GMP_GAS_DROPS.toString(),              // gas only, no tokens
  Destination: "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2", // Axelar gateway on XRPL
  Memos: [
    buildMemo("type",                "call_contract"),
    buildMemo("destination_address", adapterAddress),  // EVM contract to call
    buildMemo("destination_chain",   "xrpl-evm"),
    buildMemo("payload",             abiEncodedSignedIntent, true) // raw bytes
  ]
};
```

### 6.2 Memo Encoding Rules

All XRPL memos follow these encoding rules exactly:

```typescript
function utf8Hex(str: string): string {
  // Encode a plain string as UTF-8 bytes, then hex-uppercase
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function rawHex(value: string): string {
  // Strip 0x prefix, uppercase — for raw ABI-encoded bytes
  return (value.startsWith("0x") ? value.slice(2) : value).toUpperCase();
}

function buildMemo(key: string, value: string, isPayload = false) {
  let memoData: string;

  if (isPayload) {
    // ABI-encoded payload: strip 0x, uppercase hex
    memoData = rawHex(value);

  } else if (key === "destination_address") {
    // EVM 0x address: strip "0x", then UTF-8 encode the remaining hex string
    // e.g. "0x39CD..." → utf8("39CD...") → hex uppercase
    memoData = utf8Hex(value.replace(/^0x/, ""));

  } else {
    // All other fields: plain string → UTF-8 → hex uppercase
    // e.g. "call_contract" → "63616C6C5F636F6E7472616374"
    memoData = utf8Hex(value);
  }

  return {
    Memo: {
      MemoType: utf8Hex(key),   // always UTF-8 hex of the key name
      MemoData: memoData
    }
  };
}
```

**Memo fields for `call_contract`:**

| Memo Key | Memo Value (before encoding) | MemoData encoding |
|----------|-----------------------------|--------------------|
| `type` | `"call_contract"` | UTF-8 hex of string |
| `destination_address` | EVM address e.g. `"0x39CD..."` | UTF-8 hex of hex-string (strip 0x) |
| `destination_chain` | `"xrpl-evm"` | UTF-8 hex of string |
| `payload` | ABI-encoded bytes (0x-prefixed) | Raw hex (strip 0x, uppercase) |

### 6.3 On-Chain Handler: `execute()`

```solidity
function execute(
    bytes32 commandId,
    string calldata sourceChain,
    string calldata sourceAddress,
    bytes calldata payload
) external whenNotPaused {
    // 1. Validate with Axelar gateway (reverts if not approved)
    if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, keccak256(payload))) {
        revert NotApprovedByGateway();
    }
    // 2. Decode SignedIntent from payload
    // 3. Verify ECDSA signature against intentSignerOfXrplAccount[xrplAccount]
    // 4. Reject if actionType is not BORROW or WITHDRAW
    // 5. Idempotency check (lock intentId)
    // 6. Validate nonce
    // 7. Execute: _borrow() or _withdraw() via user proxy
    // 8. _egress(): pull tokens from proxy → ITS.interchainTransfer() → back to XRPL
    // 9. Increment nonce
}
```

**Key rule**: Do NOT check `msg.sender == gateway` in `execute()`. The Axelar relayer EOA calls `execute()` directly after obtaining gateway approval. The gateway approval is validated via `gateway.validateContractCall()`.

### 6.4 destinationAddress in WITHDRAW/BORROW Intents

For GMP intents (WITHDRAW/BORROW), `envelope.destinationAddress` is the XRPL wallet address where the returned XRP will be sent. Encode it as UTF-8 bytes:

```typescript
const destinationAddressBytes = ethers.hexlify(
  ethers.toUtf8Bytes(xrplWallet.address)  // XRPL r-address string
);
// e.g. "0x72486239434a41..." (UTF-8 encoding of "rHb9CJAWyB4rj91...")
```

This is stored in `envelope.destinationAddress` (as `bytes`) and passed directly to the ITS egress call.

### 6.5 Full WITHDRAW Example

```typescript
const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`xrpl-withdraw:${xrplWallet.address}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address)),
  market:             "0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6", // sXRP
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // native XRP
  actionType:         3,           // WITHDRAW
  amount:             ethers.parseEther("2"),  // 2 XRP in 18-decimal wei
  nonce:              BigInt(await adapter.nextNonceByXrplAccount(xrplAccount)),
  deadline:           BigInt(0),   // no expiry
  destinationAddress: ethers.hexlify(ethers.toUtf8Bytes(xrplWallet.address)),
  version:            1
};

const payloadHash = hashEnvelope(envelope);
const digest      = buildDigest(adapterAddress, network.chainId, payloadHash);
const signature   = await evmSigner.signMessage(ethers.getBytes(digest));
const payload     = encodeSignedIntent(envelope, signature);

const tx: Payment = {
  TransactionType: "Payment",
  Account:         xrplWallet.address,
  Amount:          "3000000",  // 3 XRP gas in drops
  Destination:     "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  Memos: [
    buildMemo("type",                "call_contract"),
    buildMemo("destination_address", "0x39CD36305a266E3F9748C182cc16edAc502853b0"),
    buildMemo("destination_chain",   "xrpl-evm"),
    buildMemo("payload",             payload, true)
  ]
};
```

---

## 7. Flow 2 — XRPL → XRPL EVM via ITS (`interchain_transfer`)

**Use for**: SUPPLY (actionType=0) and REPAY (actionType=2)

The XRPL Payment carries **deposit XRP + relay gas XRP** in a single payment. The Axelar ITS intercepts it, mints XRP on XRPL EVM to the destination contract, then calls `executeWithInterchainToken()`.

### 7.1 XRPL Payment Structure

```typescript
const depositDrops = 5_000_000n;  // amount to deposit/repay (6-decimal drops)
const gasFeeDrops  = 2_000_000n;  // Axelar relay gas (separate from deposit)
const totalDrops   = depositDrops + gasFeeDrops;

const tx: Payment = {
  TransactionType: "Payment",
  Account:     xrplWallet.address,
  Amount:      totalDrops.toString(),                  // deposit + gas in one payment
  Destination: "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  Memos: [
    buildMemo("type",                "interchain_transfer"),
    buildMemo("destination_address", adapterAddress),   // ITS delivers XRP here
    buildMemo("destination_chain",   "xrpl-evm"),
    buildMemo("gas_fee_amount",      gasFeeDrops.toString()), // how much of total is gas
    buildMemo("payload",             abiEncodedSignedIntent, true)
  ]
};
```

**Memo fields for `interchain_transfer`:**

| Memo Key | Value | MemoData encoding |
|----------|-------|-------------------|
| `type` | `"interchain_transfer"` | UTF-8 hex |
| `destination_address` | EVM adapter address | UTF-8 hex of hex-string (strip 0x) |
| `destination_chain` | `"xrpl-evm"` | UTF-8 hex |
| `gas_fee_amount` | gas drops as decimal string | UTF-8 hex |
| `payload` | ABI-encoded SignedIntent | Raw hex (strip 0x, uppercase) |

**Token amount delivered on XRPL EVM**: `(totalDrops - gasFeeDrops) × 10^12 = depositDrops × 10^12`

### 7.2 Amount Alignment (Critical)

The ITS delivers exactly `depositDrops × 10^12` wei to the adapter. The `envelope.amount` MUST equal this value:

```typescript
const DROPS_TO_EVM_SCALE = BigInt(10 ** 12);
const depositAmountEVM   = depositDrops * DROPS_TO_EVM_SCALE; // 18-decimal wei

const envelope = {
  ...
  amount: depositAmountEVM,  // MUST match what ITS will deliver
  ...
};
```

If there is a mismatch, the adapter reverts with `AmountMismatch(expected, provided)`.

### 7.3 On-Chain Handler: `executeWithInterchainToken()`

```solidity
function executeWithInterchainToken(
    bytes32 commandId,       // consumed by ITS; unused by adapter (intent hash = idempotency)
    string calldata sourceChain,
    bytes calldata sourceAddress,
    bytes calldata data,     // ABI-encoded SignedIntent
    bytes32 tokenId,         // ITS token ID (must match market config)
    address token,           // 0xEeee...EEeE on XRPL EVM
    uint256 amount           // EVM wei delivered by ITS
) external whenNotPaused returns (bytes32) {
    // 1. Only ITS can call this
    if (msg.sender != address(interchainTokenService)) revert NotInterchainTokenService();
    // 2. Decode, validate envelope, verify signature
    // 3. Reject if actionType is not SUPPLY or REPAY
    // 4. Verify token, tokenId, amount all match market config and envelope
    // 5. Idempotency check (lock intentId)
    // 6. Validate nonce
    // 7. Execute: _supply() or _repay() via user proxy
    // 8. Increment nonce
    return ITS_EXECUTE_SUCCESS; // keccak256("its-execute-success")
}
```

**Critical**: `executeWithInterchainToken` MUST return `keccak256("its-execute-success")` at **every** exit path. If it returns `bytes32(0)` or reverts, the ITS raises `CANNOT_EXECUTE_MESSAGE/V2` and the transaction is stuck.

```solidity
bytes32 public constant ITS_EXECUTE_SUCCESS = keccak256("its-execute-success");

function executeWithInterchainToken(...) external returns (bytes32) {
    ...
    if (isDuplicate) {
        emit IntentDuplicateIgnored(intentId, payloadHash);
        return ITS_EXECUTE_SUCCESS;  // ← early exit MUST still return this
    }
    ...
    return ITS_EXECUTE_SUCCESS;      // ← normal exit
}
```

### 7.4 destinationAddress in SUPPLY/REPAY Intents

For ITS intents (SUPPLY/REPAY), the adapter does not egress tokens back. Set `destinationAddress` to empty:

```typescript
const envelope = {
  ...
  destinationAddress: "0x",  // no egress for SUPPLY/REPAY
  ...
};
```

### 7.5 Full SUPPLY Example

```typescript
const depositDrops    = 5_000_000n;
const gasFeeDrops     = 2_000_000n;
const depositAmountEVM = depositDrops * BigInt(10 ** 12);

const envelope = {
  intentId:           ethers.keccak256(ethers.toUtf8Bytes(`xrpl-deposit:${xrplWallet.address}:${nonce}:${Date.now()}`)),
  xrplAccount:        ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address)),
  market:             "0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6", // sXRP
  underlying:         "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  actionType:         0,              // SUPPLY
  amount:             depositAmountEVM,
  nonce:              BigInt(await adapter.nextNonceByXrplAccount(xrplAccount)),
  deadline:           BigInt(0),
  destinationAddress: "0x",          // no return egress for SUPPLY
  version:            1
};

const payloadHash = hashEnvelope(envelope);
const digest      = buildDigest(adapterAddress, network.chainId, payloadHash);
const signature   = await evmSigner.signMessage(ethers.getBytes(digest));
const payload     = encodeSignedIntent(envelope, signature);

const tx: Payment = {
  TransactionType: "Payment",
  Account:         xrplWallet.address,
  Amount:          (depositDrops + gasFeeDrops).toString(),
  Destination:     "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
  Memos: [
    buildMemo("type",                "interchain_transfer"),
    buildMemo("destination_address", "0x39CD36305a266E3F9748C182cc16edAc502853b0"),
    buildMemo("destination_chain",   "xrpl-evm"),
    buildMemo("gas_fee_amount",      gasFeeDrops.toString()),
    buildMemo("payload",             payload, true)
  ]
};
```

---

## 8. Flow 3 — XRPL EVM → XRPL Ledger via ITS (`interchainTransfer`)

**Use for**: Returning XRP to the user's XRPL wallet after WITHDRAW or BORROW

This is a Solidity-side call made inside `adapter._egress()`. The adapter pulls tokens from the user proxy and calls `ITS.interchainTransfer()` to send them back to XRPL Ledger.

### 8.1 Solidity Egress Call

From `XRPLSecurdBridgeAdapter._egress()`:

```solidity
function _egress(address proxy, XRPLSecurdTypes.IntentEnvelope memory envelope) internal {
    if (envelope.destinationAddress.length == 0) revert InvalidDestinationAddress();

    MarketConfig memory cfg = _requireMarket(envelope.market);

    // 1. Pull redeemed/borrowed tokens from proxy to adapter
    bytes memory pullData = abi.encodeWithSelector(
        IERC20.transfer.selector,
        address(this),
        envelope.amount
    );
    _proxyTokenCall(proxy, envelope.underlying, pullData);

    // 2. Approve ITS to spend the tokens
    _safeApprove(envelope.underlying, address(interchainTokenService), 0);
    _safeApprove(envelope.underlying, address(interchainTokenService), envelope.amount);

    // 3. Send back to XRPL Ledger via ITS
    interchainTokenService.interchainTransfer{value: egressGasValue}(
        cfg.tokenId,             // ITS token ID for this asset
        destinationChain,        // "xrpl" — set via setDestinationChain()
        envelope.destinationAddress, // UTF-8 encoded XRPL r-address bytes
        envelope.amount,         // 18-decimal wei to send back
        bytes(""),               // no metadata
        egressGasValue           // gas prepayment (must equal msg.value)
    );
}
```

### 8.2 Encoding the XRPL Return Address

The XRPL r-address must be UTF-8 encoded as bytes (NOT hex-encoded):

```typescript
// In TypeScript (building the intent payload):
const xrplReturnAddress   = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"; // XRPL r-address
const destinationAddressBytes = ethers.hexlify(ethers.toUtf8Bytes(xrplReturnAddress));
// Result: "0x724862394341..." — UTF-8 bytes of the r-address string

// In Solidity (ITS call side):
bytes memory destination = bytes(xrplAddressString);
// OR if coming from envelope.destinationAddress which is already UTF-8 bytes:
// pass envelope.destinationAddress directly
```

The ITS decodes this back to the XRPL r-address when routing the return transfer on XRPL Ledger.

### 8.3 Gas Requirements for Egress

The adapter must hold native XRP to pay `egressGasValue` for each egress ITS call. Set `egressGasValue` to at least 1 XRP (1e18 wei) on testnet:

```typescript
// Admin: set egress gas value
await adapter.connect(owner).setEgressGasValue(ethers.parseEther("1"));

// Admin: fund adapter with native XRP for multiple egress operations
await deployer.sendTransaction({
  to: adapterAddress,
  value: ethers.parseEther("5")  // 5 XRP covers 5 egress calls at 1 XRP each
});

// Check adapter's XRP balance
const balance = await provider.getBalance(adapterAddress);
console.log("Adapter XRP balance:", ethers.formatEther(balance));

// Check configured egress gas value
const egressGas = await adapter.egressGasValue();
console.log("Egress gas value:", ethers.formatEther(egressGas));
```

If the adapter has insufficient XRP for egress, the `interchainTransfer` call reverts with `TransferFailed`.

### 8.4 Amount Reversal

XRP amounts go through a round-trip scaling:
```
XRPL send:  depositDrops (6-decimal)
            ↓ ITS inbound scale × 10^12
XRPL EVM:   depositAmountEVM (18-decimal wei)
            ↓ lending operations (cToken mint, redeem)
            ↓ ITS outbound (no scale applied by ITS — amount is passed as-is)
XRPL recv:  depositDrops received back (Axelar ITS scales back ÷ 10^12)
```

The user receives `envelope.amount ÷ 10^12` drops back on XRPL Ledger (after protocol fees if any).

---

## 9. On-Chain Execution Logic

### 9.1 SUPPLY Flow (`_supply`)

```
ITS mints XRP → adapter
adapter transfers XRP → proxy
proxy approves cToken market
proxy calls cToken.mint(amount)         → proxy receives cToken shares
adapter resets approval (security)
proxy calls comptroller.enterMarkets()  → cToken counted as collateral
```

### 9.2 REPAY Flow (`_repay`)

```
ITS mints XRP → adapter
adapter transfers XRP → proxy
proxy approves cToken market
proxy calls cToken.repayBorrow(amount)  → proxy's debt reduced
adapter resets approval
```

### 9.3 WITHDRAW Flow (`_withdraw` + `_egress`)

```
adapter.execute() called by Axelar relayer EOA
proxy calls cToken.redeemUnderlying(amount) → proxy receives XRP
adapter pulls XRP from proxy (proxy.transfer → adapter)
adapter approves ITS
adapter calls ITS.interchainTransfer()      → XRP bridged back to XRPL
```

### 9.4 BORROW Flow (`_borrow` + `_egress`)

```
adapter.execute() called by Axelar relayer EOA
proxy calls cToken.borrow(amount)           → proxy receives XRP
adapter pulls XRP from proxy
adapter approves ITS
adapter calls ITS.interchainTransfer()      → XRP bridged back to XRPL
```

### 9.5 User Proxy Execution

The adapter never calls protocols directly. All lending operations go through the user's proxy:

```solidity
// adapter calls proxy like this:
proxy.execute(target, 0, calldata);

// proxy internally does:
(bool ok, bytes memory out) = target.call{value: value}(data);
```

The proxy is deployed on first use with CREATE2 using `keccak256(abi.encodePacked(xrplAccount))` as salt.

---

## 10. Admin Setup Sequence

Before any user can execute intents, an admin must configure the adapter:

```typescript
const adapter = new ethers.Contract(adapterAddress, ADAPTER_ABI, ownerSigner);

// 1. Register the lending market
await adapter.setMarket(
  cTokenAddress,      // sXRP market: 0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6
  underlyingAddress,  // 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
  tokenId,            // ITS tokenId from marketConfig or ITS registry
  true                // listed = true
);

// 2. Set the destination chain for egress (XRPL Ledger)
await adapter.setDestinationChain("xrpl");

// 3. Set egress gas value (1 XRP minimum for testnet)
await adapter.setEgressGasValue(ethers.parseEther("1"));

// 4. Fund adapter with XRP for egress gas
await ownerSigner.sendTransaction({ to: adapterAddress, value: ethers.parseEther("5") });

// 5. Register intent signer for each XRPL user account
const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplRAddress));
await adapter.setIntentSigner(xrplAccount, evmSignerAddress);
```

### Admin ABIs

```typescript
const ADAPTER_ADMIN_ABI = [
  // Config
  "function setMarket(address market, address underlying, bytes32 tokenId, bool listed) external",
  "function setDestinationChain(string calldata chain) external",
  "function setEgressGasValue(uint256 value) external",
  "function setIntentSigner(bytes32 xrplAccount, address signer) external",
  // Emergency
  "function resetNonce(bytes32 xrplAccount, uint64 newNonce) external",
  "function rescueERC20(address token, address to, uint256 amount) external",
  "function withdrawNative(address payable to, uint256 amount) external",
  "function pause() external",
  "function unpause() external",
  // Views
  "function marketConfigOf(address market) view returns (address underlying, bytes32 tokenId, bool listed)",
  "function intentSignerOfXrplAccount(bytes32 xrplAccount) view returns (address)",
  "function nextNonceByXrplAccount(bytes32 xrplAccount) view returns (uint64)",
  "function egressGasValue() view returns (uint256)",
  "function destinationChain() view returns (string)",
  "function gateway() view returns (address)",
  "function interchainTokenService() view returns (address)",
  "function proxyFactory() view returns (address)"
];
```

---

## 11. Complete TypeScript Reference

### 11.1 Memo Helpers

```typescript
function utf8Hex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function rawHex(value: string): string {
  return (value.startsWith("0x") ? value.slice(2) : value).toUpperCase();
}

function buildMemo(key: string, value: string, isPayload = false) {
  let memoData: string;
  if (isPayload) {
    memoData = rawHex(value);
  } else if (key === "destination_address") {
    memoData = utf8Hex(value.replace(/^0x/, ""));
  } else {
    memoData = utf8Hex(value);
  }
  return { Memo: { MemoType: utf8Hex(key), MemoData: memoData } };
}
```

### 11.2 Envelope Helpers

```typescript
import { ethers } from "ethers";

const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

interface IntentEnvelope {
  intentId:           string;   // bytes32 hex
  xrplAccount:        string;   // bytes32 hex
  market:             string;   // address
  underlying:         string;   // address
  actionType:         number;   // 0=SUPPLY 1=BORROW 2=REPAY 3=WITHDRAW
  amount:             bigint;   // 18-decimal EVM wei
  nonce:              bigint;
  deadline:           bigint;   // 0 = no expiry
  destinationAddress: string;   // bytes hex (UTF-8 encoded XRPL r-address, or "0x")
  version:            number;   // always 1
}

function hashEnvelope(e: IntentEnvelope): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","bytes32","address","address","uint8","uint256","uint64","uint64","bytes","uint16"],
      [e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version]
    )
  );
}

function buildDigest(adapterAddress: string, chainId: bigint, payloadHash: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32"],
      [adapterAddress, chainId, payloadHash]
    )
  );
}

function encodeSignedIntent(e: IntentEnvelope, signature: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version],
      signature]]
  );
}

async function signEnvelope(
  e: IntentEnvelope,
  adapterAddress: string,
  signer: ethers.Wallet
): Promise<string> {
  const network     = await signer.provider!.getNetwork();
  const payloadHash = hashEnvelope(e);
  const digest      = buildDigest(adapterAddress, network.chainId, payloadHash);
  return signer.signMessage(ethers.getBytes(digest)); // EIP-191
}
```

### 11.3 Payment Builders

```typescript
import { Payment } from "xrpl";

const XRPL_GATEWAY  = "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2";
const XRPL_EVM_CHAIN = "xrpl-evm";

// GMP (call_contract) — gas only, no tokens
function buildGmpPayment(
  senderAddress: string,
  evmContract:   string,
  payload:       string,      // 0x-prefixed ABI-encoded bytes
  gasDrops = 3_000_000n
): Payment {
  return {
    TransactionType: "Payment",
    Account:     senderAddress,
    Amount:      gasDrops.toString(),
    Destination: XRPL_GATEWAY,
    Memos: [
      buildMemo("type",                "call_contract"),
      buildMemo("destination_address", evmContract),
      buildMemo("destination_chain",   XRPL_EVM_CHAIN),
      buildMemo("payload",             payload, true),
    ],
  };
}

// ITS (interchain_transfer) — tokens + gas
function buildItsPayment(
  senderAddress: string,
  evmContract:   string,
  depositDrops:  bigint,
  gasFeeDrops:   bigint,
  payload:       string       // 0x-prefixed ABI-encoded bytes
): Payment {
  return {
    TransactionType: "Payment",
    Account:     senderAddress,
    Amount:      (depositDrops + gasFeeDrops).toString(),
    Destination: XRPL_GATEWAY,
    Memos: [
      buildMemo("type",                "interchain_transfer"),
      buildMemo("destination_address", evmContract),
      buildMemo("destination_chain",   XRPL_EVM_CHAIN),
      buildMemo("gas_fee_amount",      gasFeeDrops.toString()),
      buildMemo("payload",             payload, true),
    ],
  };
}
```

### 11.4 Submission Helper

```typescript
import { Client, Wallet, Payment } from "xrpl";

async function submitAndLog(
  wallet:  Wallet,
  tx:      Payment,
  rpcUrl = "wss://s.altnet.rippletest.net:51233"
): Promise<string> {
  const client = new Client(rpcUrl);
  await client.connect();
  try {
    const prepared = await client.autofill(tx);
    const signed   = wallet.sign(prepared);
    console.log("Submitting XRPL payment...");
    const result = await client.submitAndWait(signed.tx_blob);
    const hash   = (result as any).result?.hash as string;
    console.log("XRPL tx:  https://testnet.xrpl.org/transactions/" + hash);
    console.log("Axelar:   https://testnet.axelarscan.io/gmp/" + hash.toLowerCase());
    return hash;
  } finally {
    await client.disconnect();
  }
}
```

### 11.5 On-Chain Verification Helpers

```typescript
const ADAPTER_ABI = [
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
  "function marketConfigOf(address) view returns (address underlying, bytes32 tokenId, bool listed)",
  "function egressGasValue() view returns (uint256)",
  "function destinationChain() view returns (string)"
];

const FACTORY_ABI = [
  "function proxyOf(bytes32) view returns (address)",
  "function predictProxy(bytes32) view returns (address)"
];

const CTOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function balanceOfUnderlying(address) returns (uint256)"  // not view — requires call
];

async function verifyState(
  provider:        ethers.JsonRpcProvider,
  adapterAddress:  string,
  factoryAddress:  string,
  marketAddress:   string,
  xrplRAddress:    string
) {
  const adapter = new ethers.Contract(adapterAddress, ADAPTER_ABI, provider);
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
  const cToken  = new ethers.Contract(marketAddress,  CTOKEN_ABI,  provider);

  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplRAddress));
  const nonce       = await adapter.nextNonceByXrplAccount(xrplAccount);
  const proxy       = await factory.proxyOf(xrplAccount);
  const cBalance    = proxy !== ethers.ZeroAddress
    ? await cToken.balanceOf(proxy)
    : 0n;

  console.log("xrplAccount:", xrplAccount);
  console.log("proxy:      ", proxy);
  console.log("nonce:      ", nonce.toString());
  console.log("cToken bal: ", ethers.formatUnits(cBalance, 8), "sXRP");  // cToken decimals = 8
  console.log("adapter XRP:", ethers.formatEther(await provider.getBalance(adapterAddress)));
}
```

---

## 12. Decision Guide

### Which flow to use?

```
Has the user triggered this from XRPL Ledger?
├── YES → Are tokens being SENT from XRPL to XRPL EVM?
│         ├── YES (depositing/repaying)
│         │   └── Flow 2: ITS interchain_transfer
│         │       Memo type = "interchain_transfer"
│         │       Amount = depositDrops + gasFeeDrops
│         │       actionType = SUPPLY(0) or REPAY(2)
│         │
│         └── NO (only triggering an action, tokens return from EVM)
│             └── Flow 1: GMP call_contract
│                 Memo type = "call_contract"
│                 Amount = gasDrops only
│                 actionType = WITHDRAW(3) or BORROW(1)
│
└── NO → Tokens are being sent from XRPL EVM back to XRPL Ledger
         └── Flow 3: ITS interchainTransfer (Solidity)
             Called by adapter._egress() after WITHDRAW or BORROW executes
```

### Summary Table

| Goal | Flow | Memo `type` | XRPL Payment Amount | `actionType` | EVM hook |
|------|------|-------------|---------------------|--------------|----------|
| Deposit XRP into lending | 2 — ITS inbound | `interchain_transfer` | depositDrops + gasDrops | 0 (SUPPLY) | `executeWithInterchainToken` |
| Repay borrow | 2 — ITS inbound | `interchain_transfer` | repayDrops + gasDrops | 2 (REPAY) | `executeWithInterchainToken` |
| Withdraw from lending | 1 — GMP | `call_contract` | gasDrops only | 3 (WITHDRAW) | `execute` |
| Borrow from lending | 1 — GMP | `call_contract` | gasDrops only | 1 (BORROW) | `execute` |
| Return XRP to user | 3 — ITS outbound | (Solidity call) | N/A | N/A | None |

---

## 13. Error Reference

### Contract Errors

| Error | Trigger | Fix |
|-------|---------|-----|
| `NotApprovedByGateway` | `execute()` called but gateway hasn't approved the commandId | Relayer must call after gateway processes the XRPL tx; cannot fix client-side |
| `NotInterchainTokenService` | `executeWithInterchainToken` called by non-ITS address | Only ITS can call this; do not expose it to arbitrary callers |
| `CANNOT_EXECUTE_MESSAGE/V2` | ITS hook returned wrong value | Return `keccak256("its-execute-success")` at all exit paths |
| `AmountMismatch(expected, provided)` | `envelope.amount` ≠ ITS-delivered amount | Set `envelope.amount = depositDrops × 10^12` |
| `InvalidNonce(provided, expected)` | Stale or wrong nonce in envelope | Re-read `adapter.nextNonceByXrplAccount(xrplAccount)` before building intent |
| `IntentHashConflict` | Same `intentId` used with a different payload | Always generate a new random/timestamped `intentId` per intent |
| `IntentSignerNotConfigured` | No signer registered for this XRPL account | Admin calls `adapter.setIntentSigner(xrplAccount, signer)` |
| `InvalidIntentSignature` | Signature verification failed | Check: correct `adapterAddress`, correct `chainId`, correct signer key, EIP-191 signMessage |
| `MarketNotListed` | Market address not registered or `listed=false` | Admin calls `adapter.setMarket(...)` |
| `TokenMismatch` | `envelope.underlying` ≠ market's underlying | Use `adapter.marketConfigOf(market).underlying` |
| `TokenIdMismatch` | ITS tokenId ≠ market config tokenId | Use `adapter.marketConfigOf(market).tokenId` |
| `UnsupportedIngressPath(actionType, tokenFlow)` | Wrong action type for the path | SUPPLY/REPAY must use ITS; WITHDRAW/BORROW must use GMP |
| `InvalidAmount` | `envelope.amount == 0` | Always send a non-zero amount |
| `DeadlineExpired` | `deadline != 0` and `block.timestamp > deadline` | Set `deadline = 0` or use a future timestamp |
| `InvalidDestinationAddress` | `destinationAddress.length == 0` on GMP path | Set `destinationAddress` to UTF-8 bytes of XRPL r-address |
| `UnsupportedVersion` | `envelope.version != 1` | Always set `version: 1` |
| `TransferFailed` during egress | Adapter has no XRP balance for `egressGasValue` | Fund adapter; verify `egressGasValue` is set |
| `SecurdCallFailed(actionType, errorCode)` | cToken `mint`/`borrow`/etc returned non-zero | Check Compound error codes; ensure liquidity and market state |
| `ProxyCallFailed` | Proxy call reverted | Check proxy is deployed; check inner revert via eth_call |
| `IntentDuplicateIgnored` (event, not error) | Intent already processed | Normal — idempotency working correctly |

### XRPL-Side Issues

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Axelarscan never picks up tx | Memo encoding wrong | Verify raw MemoData bytes match expected encoding |
| Relayer picks up but `execute` reverts | Gateway approval check fails | Ensure `commandId` matches the gateway's approved hash |
| GMP payload not decoded | Payload has `0x` prefix in MemoData | Strip `0x` before putting raw hex in MemoData |
| ITS delivers wrong amount | `gas_fee_amount` too large | Ensure `gas_fee_amount` < total Payment Amount |

---

## 14. Verification Checklist

### Before Submitting

- [ ] `adapter.intentSignerOfXrplAccount(xrplAccount)` matches local signer key
- [ ] `adapter.marketConfigOf(market).listed == true`
- [ ] `adapter.marketConfigOf(market).underlying` matches `envelope.underlying`
- [ ] `adapter.nextNonceByXrplAccount(xrplAccount)` matches `envelope.nonce`
- [ ] For ITS: `envelope.amount == depositDrops × 10^12`
- [ ] For GMP: `envelope.destinationAddress` is non-empty UTF-8 bytes of XRPL r-address
- [ ] For egress: `provider.getBalance(adapterAddress) >= adapter.egressGasValue()`
- [ ] `envelope.version == 1`
- [ ] `envelope.deadline == 0` (or future timestamp in seconds)

### After Submitting

```typescript
// 1. Confirm XRPL tx finalized
// https://testnet.xrpl.org/transactions/${txHash}

// 2. Monitor Axelar relay (~30-60 seconds)
// https://testnet.axelarscan.io/gmp/${txHash.toLowerCase()}

// 3. Verify nonce advanced by 1 (confirms intent executed)
const newNonce = await adapter.nextNonceByXrplAccount(xrplAccount);
// should be previousNonce + 1

// 4. Verify proxy position changed
const proxy    = await factory.proxyOf(xrplAccount);
const cBalance = await cToken.balanceOf(proxy);
// SUPPLY: increased from 0 to depositAmount/exchangeRate
// WITHDRAW: decreased by withdrawAmount/exchangeRate

// 5. For WITHDRAW: verify XRPL wallet received drops
// Check XRPL explorer for incoming payment from gateway address rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2

// 6. Verify adapter XRP balance still covers future egress
const adapterBalance = await provider.getBalance(adapterAddress);
const egressGas      = await adapter.egressGasValue();
console.log("Remaining egress capacity:", adapterBalance / egressGas, "operations");
```
