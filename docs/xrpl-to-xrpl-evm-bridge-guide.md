# XRPL Ledger → XRPL EVM Bridge Guide (via Axelar)

This guide covers everything needed to send transactions from the XRPL Ledger to XRPL EVM via the Axelar protocol — including all pitfalls discovered and fixed during integration testing.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Live Testnet Addresses](#2-live-testnet-addresses)
3. [EVM Receiver Contract Rules](#3-evm-receiver-contract-rules)
4. [GMP call_contract Flow](#4-gmp-call_contract-flow)
5. [ITS interchain_transfer Flow](#5-its-interchain_transfer-flow)
6. [Memo Encoding Rules](#6-memo-encoding-rules)
7. [Common Mistakes and How to Avoid Them](#7-common-mistakes-and-how-to-avoid-them)
8. [Verifying Delivery](#8-verifying-delivery)

---

## 1. Architecture Overview

```
XRPL Ledger                   Axelar Network               XRPL EVM
───────────────────────────────────────────────────────────────────
Payment tx                                                
  └─ Destination: Axelar                                  
     XRPL Gateway             ┌─ Confirm & Route ─┐       
  └─ Memos encode:            │                   │       
       type                   │                   ▼       
       destination_chain  ────┘            ContractCallApproved
       destination_address                 on AxelarGateway EVM
       payload / gas_fee                        │
                                                ▼
                                     Relayer calls execute()
                                     on destination contract
```

For ITS token transfers, the Axelar ITS hub on Axelar chain acts as an intermediary between XRPL Ledger and XRPL EVM.

---

## 2. Live Testnet Addresses

These are the only addresses the Axelar testnet relayer uses. Do not use addresses from the XRPL EVM docs page — that page references a stale deployment.

### XRPL Ledger (testnet)

| Role | Value |
|---|---|
| Axelar Gateway (XRPL account) | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |
| XRPL RPC | `wss://s.altnet.rippletest.net:51233` |
| Source chain name (Axelar) | `xrpl` |

### XRPL EVM (testnet, chainId 1449000)

| Role | Address |
|---|---|
| AxelarGateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| InterchainTokenService | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| InterchainTokenFactory | `0x83a93500d23Fbc3e82B410aD07A6a9F7A0670D66` |
| AxelarGasService | `0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6` |
| wXRP token ID | `0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f` |
| XRPL EVM RPC | `https://rpc.testnet.xrplevm.org` |
| Axelar chain name | `xrpl-evm` |

---

## 3. EVM Receiver Contract Rules

This is the most critical section. Three bugs were found and fixed during testing — all in the EVM receiver contract.

### Rule 1 — Never add `msg.sender != gateway` in `execute()`

**Wrong:**
```solidity
function execute(bytes32 commandId, string calldata sourceChain,
                 string calldata sourceAddress, bytes calldata payload) external {
    if (msg.sender != address(gateway)) revert NotGateway(); // ❌ WRONG
    if (!gateway.validateContractCall(...)) revert NotApprovedByGateway();
    ...
}
```

**Correct:**
```solidity
function execute(bytes32 commandId, string calldata sourceChain,
                 string calldata sourceAddress, bytes calldata payload) external {
    if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, keccak256(payload)))
        revert NotApprovedByGateway(); // ✅ gateway.validateContractCall() is the sole security check
    ...
}
```

**Why:** The Axelar relayer calls `execute()` directly from its own EOA — it is NOT the gateway contract. The gateway only writes the approval on-chain. `gateway.validateContractCall()` is the correct and sufficient security boundary. Adding an `msg.sender == gateway` guard causes `EstimationReverted` during the relayer's gas estimation and the message is never delivered.

### Rule 2 — Do not add trusted source guards without knowing the exact source address

**Wrong:**
```solidity
bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
if (!trustedGmpSource[sourceId]) revert UntrustedSource(sourceId); // ❌ WRONG if mapping is empty
```

**Why:** The Axelar relayer passes the original XRPL sender's address as `sourceAddress` (e.g. `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48`). This value changes per sender. If you add a trusted source guard without populating it with the exact value the relayer will use, every incoming call will revert. For a demo or public receiver, rely solely on `gateway.validateContractCall()`. For a production contract that needs source restriction, call `setTrustedSource` with the confirmed relayer-provided value after testing.

### Rule 3 — Use the confirmed ITS address as `interchainTokenService`

For `executeWithInterchainToken`, `msg.sender` will be the ITS contract:

```
0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C
```

Your constructor must store this address and check it:

```solidity
if (msg.sender != interchainTokenService) revert NotInterchainTokenService(); // ✅ correct
```

### Minimal correct `execute()` pattern

```solidity
function execute(
    bytes32 commandId,
    string calldata sourceChain,
    string calldata sourceAddress,
    bytes calldata payload
) external {
    if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, keccak256(payload)))
        revert NotApprovedByGateway();

    // sourceChain  = "xrpl"
    // sourceAddress = original XRPL sender address string (e.g. "r4obbPEx...")
    // payload = abi.decode as needed
    _handleMessage(sourceChain, sourceAddress, payload);
}
```

---

## 4. GMP `call_contract` Flow

Send a message from XRPL Ledger to any contract on XRPL EVM with no token transfer.

### XRPL Payment structure

```
TransactionType: Payment
Account:         <your XRPL address>
Amount:          <gas drops>          // XRP to cover Axelar gas — no token transferred
Destination:     rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
Memos:
  1. type               = "call_contract"
  2. destination_address = <EVM contract address>
  3. destination_chain  = "xrpl-evm"
  4. payload            = <ABI-encoded bytes>
```

### Gas amount

3,000,000 drops (3 XRP) is sufficient for testnet. The relayer refunds the unused portion.

### Payload encoding

The payload is passed to `execute()` as raw bytes. Encode it with `ethers.AbiCoder`:

```typescript
const payload = ethers.AbiCoder.defaultAbiCoder().encode(
  ["string", "string", "uint256"],
  [senderXrplAddress, message, gasDrops]
);
```

### What the relayer passes to `execute()`

| Parameter | Value |
|---|---|
| `sourceChain` | `"xrpl"` |
| `sourceAddress` | Your XRPL wallet address (e.g. `"r4obbPEx..."`) |
| `payload` | The exact bytes from the `payload` memo |

---

## 5. ITS `interchain_transfer` Flow

Send XRP from XRPL Ledger, which arrives as wXRP on XRPL EVM.

### XRPL Payment structure

```
TransactionType: Payment
Account:         <your XRPL address>
Amount:          <transfer drops + gas drops>   // total XRP sent
Destination:     rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
Memos:
  1. type               = "interchain_transfer"
  2. destination_address = <EVM recipient address>
  3. destination_chain  = "xrpl-evm"
  4. gas_fee_amount     = <gas drops as decimal string>
```

The `Amount` field must be `transfer_amount + gas_fee_amount` in drops.

### Gas amount

1,700,000–2,000,000 drops (1.7–2 XRP) is sufficient. The relayer refunds the unused portion.

### Important limitation

**The XRPL Axelar bridge does not support an inline GMP payload alongside an ITS transfer.** A `payload` memo is silently ignored for `interchain_transfer` type messages. If you need to call `executeWithInterchainToken` on a contract, the token must be sent separately and the receiving contract must handle a plain token arrival without a data payload.

For a plain transfer (no payload), the ITS delivers wXRP directly to the destination address without calling `executeWithInterchainToken`. This is expected and correct.

---

## 6. Memo Encoding Rules

These rules were verified against confirmed working testnet transactions.

| Memo field | MemoType encoding | MemoData encoding |
|---|---|---|
| `type` | UTF-8 → hex | UTF-8 → hex |
| `destination_chain` | UTF-8 → hex | UTF-8 → hex |
| `destination_address` | UTF-8 → hex | UTF-8 hex of address **without `0x` prefix**, preserving original case |
| `gas_fee_amount` | UTF-8 → hex | UTF-8 hex of decimal string (e.g. `"2000000"`) |
| `payload` | UTF-8 → hex | **Raw ABI bytes as hex** — NOT re-encoded as UTF-8 |

### Encoding helper (TypeScript)

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
    memoData = rawHex(value);                     // raw ABI bytes
  } else if (key === "destination_address") {
    memoData = utf8Hex(value.replace(/^0x/, "")); // strip 0x, then UTF-8 hex
  } else {
    memoData = utf8Hex(value);                    // plain UTF-8 hex
  }
  return { Memo: { MemoType: utf8Hex(key), MemoData: memoData } };
}
```

---

## 7. Common Mistakes and How to Avoid Them

| Mistake | Symptom on Axelarscan | Fix |
|---|---|---|
| `msg.sender != gateway` check in `execute()` | `EstimationReverted` at execute step | Remove the check — relayer calls `execute()` directly |
| Empty `trustedGmpSource` mapping | `UntrustedSource` revert, transaction never delivered | Remove guard or populate with the confirmed relayer source address |
| Wrong `destination_chain` value | Transaction not indexed by Axelar at all | Use exactly `"xrpl-evm"` for XRPL EVM testnet |
| Sending to wrong XRPL gateway account | Transaction never picked up | Use `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` — confirmed live testnet gateway |
| Payload encoded as UTF-8 hex instead of raw bytes | Garbage payload delivered to contract | Use raw hex for the `payload` memo field only |
| Using addresses from the XRPL EVM docs page | Wrong ITS/gateway — calls routed to wrong contracts | Use only the addresses in Section 2 of this guide |

---

## 8. Verifying Delivery

### Step 1 — Check Axelarscan

```
https://testnet.axelarscan.io/gmp/<your_xrpl_tx_hash>
```

A healthy transaction progresses through:
1. `gas_paid` — gas registered
2. `confirm` — confirmed on Axelar
3. `approved` — `ContractCallApproved` emitted on XRPL EVM gateway
4. `executed` — `execute()` called successfully on your contract

If it stops at `approved` with an `EstimationReverted` error, the contract is reverting — check the rules in Section 3.

### Step 2 — Query the receiver contract

```typescript
const provider = new ethers.JsonRpcProvider("https://rpc.testnet.xrplevm.org");
const receiver = new ethers.Contract(receiverAddress, ABI, provider);

const total = await receiver.totalGmpMessages();   // should increment
const last  = await receiver.lastGmpMessage();     // inspect fields
```

### Step 3 — Check XRPL Ledger explorer

```
https://testnet.xrpl.org/transactions/<hash>
```

Verify `TransactionResult: tesSUCCESS` and that `Destination` is the Axelar gateway account.
