# XRPL Ledger → XRPL EVM Lending Guide (Securd via Axelar)

This document explains the full integration between the XRPL Ledger and the Securd lending protocol on XRPL EVM via the Axelar bridge. It covers the architecture, every bug discovered and fixed during integration testing, and step-by-step instructions for executing lending transactions.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Live Testnet Addresses](#2-live-testnet-addresses)
3. [How Native XRP Works on XRPL EVM](#3-how-native-xrp-works-on-xrpl-evm)
4. [Amount Scaling: Drops vs EVM Wei](#4-amount-scaling-drops-vs-evm-wei)
5. [Bugs Found and Fixed](#5-bugs-found-and-fixed)
6. [Deploying the Securd Stack](#6-deploying-the-securd-stack)
7. [Executing a SUPPLY (Deposit) Transaction](#7-executing-a-supply-deposit-transaction)
8. [Verifying Delivery](#8-verifying-delivery)
9. [Supported Actions and Future Flows](#9-supported-actions-and-future-flows)

---

## 1. Architecture Overview

```
XRPL Ledger                   Axelar Network               XRPL EVM
───────────────────────────────────────────────────────────────────────
Payment tx                                                 
  Destination: Axelar          ITS Hub on Axelar           
  XRPL gateway                 (routes token + payload)    
  Memos:                                                    
    type = interchain_transfer  ─────────────────────────► ITS contract
    destination_address                                         │
    destination_chain                                       mint XRP to
    gas_fee_amount                                          adapter
    payload = SignedIntent                                      │
                                                           executeWithInterchainToken()
                                                                │
                                                      XRPLSecurdBridgeAdapter
                                                                │
                                                      verify intent signature
                                                      create user proxy (CREATE2)
                                                      transfer XRP to proxy
                                                      proxy.approve(market, amount)
                                                      cToken.mint(amount)
                                                      proxy.enterMarkets([cToken])
                                                                │
                                                           sXRP credited
                                                      to user's proxy wallet
```

### Key components

| Component | Role |
|---|---|
| XRPL Payment | Carries XRP (transfer + gas) and a signed intent encoded as memos |
| Axelar XRPL Gateway | Picks up the payment and routes it through the ITS hub |
| Axelar ITS Hub | Intermediate Cosmos chain that routes the ITS message |
| ITS on XRPL EVM | Mints native XRP to the adapter, then calls `executeWithInterchainToken` |
| `XRPLSecurdBridgeAdapter` | Verifies intent signature, creates user proxy, executes lending action |
| `XRPLUserProxy` | Per-user EVM wallet (CREATE2 deterministic), holds cToken balances |
| `CErc20Delegator` (sXRP) | Compound-style lending market accepting native XRP (via ERC20 precompile) |

---

## 2. Live Testnet Addresses

### XRPL Ledger (testnet)

| Role | Value |
|---|---|
| Axelar Gateway account | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |
| XRPL RPC | `wss://s.altnet.rippletest.net:51233` |
| Source chain name (Axelar) | `xrpl` |

### XRPL EVM (testnet, chainId 1449000)

| Role | Address |
|---|---|
| AxelarGateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| InterchainTokenService | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| XRPL EVM RPC | `https://rpc.testnet.xrplevm.org` |
| Axelar chain name | `xrpl-evm` |
| wXRP token ID | `0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f` |
| Native XRP ERC20 precompile | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |

### Securd lending stack (testnet deployment)

| Contract | Address |
|---|---|
| `XRPLSecurdBridgeAdapter` | `0x39CD36305a266E3F9748C182cc16edAc502853b0` |
| `XRPLUserProxyFactory` | `0x997BED4a9004bEb24447e1dc945c27711E852c1C` |
| `Unitroller` (Comptroller proxy) | `0x407F204191449281B51fEd22d9C2b8efc5EeBEC2` |
| `SecurdPriceOracle` | `0xC69912BA8eFb51DB140eA541C46Ea09f39c101D1` |
| sXRP cToken market | `0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6` |

---

## 3. How Native XRP Works on XRPL EVM

**Native XRP on XRPL EVM is simultaneously the native gas token and a standard ERC20.**

The address `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` is a precompile that exposes a full ERC20 interface (`name`, `symbol`, `decimals`, `transfer`, `approve`, `transferFrom`) where the balance always mirrors the account's native XRP balance. Every native XRP sent to an address is also reflected in the ERC20 balance at the same address, and vice versa.

This means:
- No WXRP wrapper contract is needed.
- The Securd `CErc20Delegator` market can use `0xEeee...` directly as its underlying asset.
- `IERC20(0xEeee...).approve(market, amount)` and `.transfer(proxy, amount)` work normally.
- The Axelar ITS mints native XRP to the bridge adapter by calling `mint()` on the precompile, which the precompile's owner (the ITS token manager) is authorized to do.

---

## 4. Amount Scaling: Drops vs EVM Wei

This is the most important numeric invariant in the entire integration.

| Chain | Token | Decimals | Unit |
|---|---|---|---|
| XRPL Ledger | XRP | 6 | 1 XRP = 1,000,000 drops |
| XRPL EVM | Native XRP / ERC20 at `0xEeee...` | 18 | 1 XRP = 10^18 wei |

**The Axelar ITS scales the amount** when bridging from XRPL Ledger to XRPL EVM:

```
EVM amount = XRPL drops × 10^12
```

Example: sending `5,000,000 drops` (= 5 XRP) from XRPL Ledger delivers `5,000,000,000,000,000,000` (= 5 × 10^18) to the destination on XRPL EVM.

### Critical rule

The `IntentEnvelope.amount` field embedded in the payload must always be in **EVM wei (18-decimal units)**, not in XRPL drops. The ITS passes the scaled EVM amount to `executeWithInterchainToken`, and the adapter checks `envelope.amount == amount`. A mismatch causes `AmountMismatch` and the relay reverts.

In `submitXrplDeposit.ts`:

```typescript
const DROPS_TO_EVM_SCALE = BigInt(10 ** 12);
const depositAmountEVM = depositAmountDrops * DROPS_TO_EVM_SCALE;
// → use depositAmountEVM in envelope.amount
// → use depositAmountDrops in the XRPL Payment Amount
```

---

## 5. Bugs Found and Fixed

Four bugs were discovered and fixed during end-to-end integration testing. All four caused the Axelar relayer to report `EstimationReverted / CANNOT_EXECUTE_MESSAGE/V2`.

### Bug 1 — `msg.sender != gateway` guard in `execute()`

**Contract:** `XRPLSecurdBridgeAdapter.sol` (`execute()` for BORROW/WITHDRAW)

**Wrong:**
```solidity
function execute(bytes32 commandId, string calldata sourceChain,
                 string calldata sourceAddress, bytes calldata payload) external {
    if (msg.sender != address(gateway)) revert NotGateway(); // ❌
    if (!gateway.validateContractCall(...)) revert NotApprovedByGateway();
    ...
}
```

**Why it fails:** The Axelar relayer calls `execute()` directly from its own EOA, not from the gateway contract. The gateway only records the approval on-chain; `validateContractCall()` is the actual security check. The `msg.sender` guard caused the relayer's gas estimation to revert before any message was delivered.

**Fix:**
```solidity
function execute(...) external {
    if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, keccak256(payload)))
        revert NotApprovedByGateway(); // ✅ sole security check
    ...
}
```

---

### Bug 2 — `trustedGmpSource` / `trustedItsSource` guards with empty mappings

**Contract:** `XRPLSecurdBridgeAdapter.sol` and `XrplEvmDemoReceiver.sol`

**Wrong:**
```solidity
bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
if (!trustedGmpSource[sourceId]) revert UntrustedSource(sourceId); // ❌ always reverts if mapping is empty
```

**Why it fails:** The Axelar relayer passes the XRPL sender's address as `sourceAddress` (e.g. `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48`). This value changes per sender. Populating the mapping per-user is impractical. For the bridge adapter the intent ECDSA signature already provides per-user authorization on top of `validateContractCall`.

**Fix:** Remove the `trustedGmpSource` check from `execute()` and the `trustedItsSource` check from `executeWithInterchainToken()`. The security model is:

| Layer | Check |
|---|---|
| GMP path | `gateway.validateContractCall()` → proves Axelar approved this payload |
| ITS path | `msg.sender == interchainTokenService` → proves ITS called the function |
| Both paths | ECDSA signature on `IntentEnvelope` → proves the authorized off-chain signer approved this specific action |

---

### Bug 3 — `executeWithInterchainToken` returned `void` instead of `bytes32`

**Contract:** `XRPLSecurdBridgeAdapter.sol`

**Wrong:**
```solidity
function executeWithInterchainToken(...) external whenNotPaused {
    // ... no return value
}
```

**Why it fails:** The ITS contract checks the return value of `executeWithInterchainToken` against a success sentinel:

```solidity
// Inside InterchainTokenService.sol
bytes32 result = IInterchainTokenExecutable(destinationAddress).executeWithInterchainToken(...);
if (result != EXECUTE_SUCCESS) revert ExecuteWithInterchainTokenFailed(destinationAddress);
```

`EXECUTE_SUCCESS = keccak256("its-execute-success") = 0xe84001f3dedacf7f9ddc370e9f09c26b37473e9e959ffdc4925f6fe33c9877e4`

A `void` function returns `bytes32(0)`, which does not match, causing the ITS itself to revert — surfacing as `CANNOT_EXECUTE_MESSAGE/V2`.

**Fix:**
```solidity
bytes32 public constant ITS_EXECUTE_SUCCESS = keccak256("its-execute-success");

function executeWithInterchainToken(...) external whenNotPaused returns (bytes32) {
    ...
    // duplicate-intent early exit:
    if (!_lockIntent(envelope.intentId, payloadHash)) {
        emit IntentDuplicateIgnored(envelope.intentId, payloadHash);
        return ITS_EXECUTE_SUCCESS; // ✅ must also return here
    }
    ...
    return ITS_EXECUTE_SUCCESS; // ✅ normal exit
}
```

Both exit paths must return the constant. Missing it on the early-return path is a common mistake.

---

### Bug 4 — Intent `amount` in XRPL drops instead of EVM wei

**Script:** `scripts/submitXrplDeposit.ts`

**Wrong:**
```typescript
const envelope = {
    ...
    amount: depositAmountDrops, // ❌ drops (6 decimals)
};
```

**Why it fails:** The `XRPLSecurdBridgeAdapter` checks:

```solidity
if (envelope.amount != amount) revert AmountMismatch(envelope.amount, amount);
```

where `amount` is the parameter passed by the ITS — already scaled to 18 decimals. Sending `5,000,000` drops becomes `5,000,000,000,000,000,000` at the EVM, so `5000000 != 5000000000000000000` → `AmountMismatch`.

**Fix:**
```typescript
const DROPS_TO_EVM_SCALE = BigInt(10 ** 12); // 10^(18-6)
const depositAmountEVM = depositAmountDrops * DROPS_TO_EVM_SCALE;

const envelope = {
    ...
    amount: depositAmountEVM, // ✅ EVM wei (18-decimal)
};
// The XRPL Payment still sends depositAmountDrops as the XRP amount
```

---

## 6. Deploying the Securd Stack

### Prerequisites

- Funded deployer on XRPL EVM testnet (get XRP from [XRPL EVM Faucet](https://faucet.xrplevm.org))
- Funded XRPL Ledger testnet account (get XRP from [XRPL Faucet](https://faucet.altnet.rippletest.net/))
- Node.js ≥ 18, `npm install` completed

### Step 1 — Create the markets config

`config/securd-markets-wxrp.json`:
```json
[
  {
    "underlying": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "cTokenName": "Securd XRP",
    "cTokenSymbol": "sXRP",
    "cTokenDecimals": 8,
    "initialExchangeRateMantissa": "1000000000000000000",
    "collateralFactorMantissa": "750000000000000000",
    "borrowCap": "0",
    "bridgeTokenId": "0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f",
    "listOnBridge": true,
    "oracle": {
      "type": "FALLBACK",
      "fallbackMaxDelay": "86400",
      "initialFallbackPrice": "2500000000000000000"
    }
  }
]
```

Notes:
- `underlying` is the native XRP ERC20 precompile — no custom wrapper needed.
- `bridgeTokenId` is the Axelar ITS token ID for wXRP on testnet.
- `initialFallbackPrice` is the XRP price in USD × 10^18 (here: $2.50).

### Step 2 — Deploy

```bash
XRPL_EVM_RPC_URL=https://rpc.testnet.xrplevm.org \
XRPL_EVM_CHAIN_ID=1449000 \
DEPLOYER_PRIVATE_KEY=<your_key> \
DEPLOY_OWNER=<owner_address> \
AXELAR_GATEWAY=0xe432150cce91c13a887f7D836923d5597adD8E31 \
INTERCHAIN_TOKEN_SERVICE=0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C \
XRPL_DESTINATION_CHAIN=xrpl \
SECURD_MARKETS_FILE=config/securd-markets-wxrp.json \
SECURD_DEPLOY_COLLATERAL_FACTOR_TIMELOCK=false \
XRPL_EGRESS_GAS_VALUE=2000000000000000 \
DEPLOYMENT_OUTPUT_FILE=deployments/xrpl-evm-testnet.json \
npx hardhat run scripts/deploySecurdStack.ts --network xrplEvm
```

This deploys: Oracle → IRM → Comptroller/Unitroller → CErc20Delegate → LiquidationKeeper → XRPLUserProxyFactory → XRPLSecurdBridgeAdapter → sXRP CErc20Delegator market.

### Step 3 — Set the intent signer

For each XRPL account that will interact with the bridge, register the authorized EVM signer:

```typescript
// xrplAccount = keccak256(toUtf8Bytes(xrplWalletAddress))
await adapter.setIntentSigner(xrplAccount, evmSignerAddress);
```

The EVM signer is the key that signs `IntentEnvelope` structs. It can be the deployer key for testing. In production, this should be a dedicated hot-wallet key controlled by the user or a trusted service.

---

## 7. Executing a SUPPLY (Deposit) Transaction

### Environment variables

```bash
# XRPL side
XRPL_SEED=<funded_testnet_seed>
XRPL_DEPOSIT_AMOUNT_DROPS=5000000       # 5 XRP to deposit
XRPL_DEPOSIT_GAS_FEE_DROPS=2000000     # 2 XRP for Axelar relay gas

# XRPL EVM side
XRPL_EVM_RPC_URL=https://rpc.testnet.xrplevm.org
DEPLOYER_PRIVATE_KEY=<intent_signer_key>
XRPL_BRIDGE_ADAPTER=0x39CD36305a266E3F9748C182cc16edAc502853b0
XRPL_DEPOSIT_MARKET=0xDfD1e10a981C11e961D2fBd0Fe00F0fab4A83dd6
XRPL_DEPOSIT_UNDERLYING=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
XRPL_DEPOSIT_DESTINATION_ADDRESS=0x39CD36305a266E3F9748C182cc16edAc502853b0

# Submission gate
XRPL_CONFIRM_SEND=false   # set true to actually submit
```

### Dry-run (inspect before submitting)

```bash
npx ts-node scripts/submitXrplDeposit.ts
```

This prints the full intent envelope, signature, and the XRPL Payment transaction without submitting. Verify that `depositAmountEVM` is `depositAmountDrops × 10^12`.

### Submit

```bash
XRPL_CONFIRM_SEND=true npx ts-node scripts/submitXrplDeposit.ts
```

### What happens under the hood

1. **Script builds `IntentEnvelope`:**
   ```
   intentId      = unique hash (nonce + timestamp)
   xrplAccount   = keccak256(xrplWalletAddress)
   market        = sXRP cToken address
   underlying    = 0xEeee... (native XRP ERC20)
   actionType    = 0  (SUPPLY)
   amount        = depositAmountDrops × 10^12  ← must be EVM wei
   nonce         = adapter.nextNonceByXrplAccount(xrplAccount)
   deadline      = 0  (no expiry)
   version       = 1
   ```

2. **Script signs the envelope** with the intent signer key:
   ```
   digest = keccak256(abi.encode(adapterAddress, chainId, keccak256(envelope)))
   signature = signMessage(digest)   // EIP-191 personal sign
   ```

3. **XRPL Payment is submitted:**
   ```
   Amount:      depositAmountDrops + gasFeeDrops   (total XRP to send)
   Destination: rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
   Memos:
     type              = "interchain_transfer"
     destination_chain = "xrpl-evm"
     destination_address = <adapter address, no 0x, UTF-8 hex>
     gas_fee_amount    = "2000000"   (UTF-8 hex of decimal string)
     payload           = <raw ABI-encoded SignedIntent bytes>
   ```

4. **Axelar relays:**
   - XRPL gateway picks up the payment
   - ITS hub on Axelar routes the message
   - ITS on XRPL EVM mints `depositAmountDrops × 10^12` native XRP to the adapter
   - ITS calls `adapter.executeWithInterchainToken(commandId, "xrpl", senderBytes, payload, tokenId, 0xEeee..., amountEVM)`

5. **Adapter executes:**
   - Verifies `msg.sender == ITS`
   - Decodes `SignedIntent` from payload
   - Validates envelope (version, intentId, market, underlying, amount, deadline)
   - Verifies ECDSA signature against registered intent signer
   - Checks `envelope.amount == amount` (both must be EVM wei)
   - Locks intent ID (prevents replay)
   - Validates and increments nonce
   - Creates user proxy via `XRPLUserProxyFactory.getOrCreateProxy(xrplAccount)` (CREATE2, deterministic)
   - Transfers XRP ERC20 from adapter to proxy: `0xEeee....transfer(proxy, amount)`
   - Proxy approves cToken market: `0xEeee....approve(sXRP, amount)`
   - Proxy mints cTokens: `sXRP.mint(amount)` → returns 0 on success
   - Proxy enters market: `Comptroller.enterMarkets([sXRP])` (enables collateral)
   - Returns `keccak256("its-execute-success")` to ITS

6. **Result:** User's proxy holds sXRP cTokens representing their deposited XRP collateral.

---

## 8. Verifying Delivery

### Step 1 — Check the XRPL transaction

```
https://testnet.xrpl.org/transactions/<hash>
```

Verify `TransactionResult: tesSUCCESS` and `Destination: rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2`.

### Step 2 — Track on Axelarscan

```
https://testnet.axelarscan.io/gmp/<lowercase_hash>
```

A successful deposit progresses through two message hops:

| Stage | Chain | What happens |
|---|---|---|
| `call` | XRPL | Payment picked up by gateway |
| `confirm` | XRPL | Confirmed on Axelar |
| `executed` | Axelar | ITS hub routes to XRPL EVM (child message created) |
| child `approved` | XRPL EVM | `ContractCallApproved` emitted by XRPL EVM ITS |
| child `executed` | XRPL EVM | `executeWithInterchainToken` succeeded |

If the child message shows `EstimationReverted`, the adapter is reverting — see Section 5 for the list of causes.

### Step 3 — Query the adapter and user proxy

```typescript
const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplWalletAddress));

// Nonce advanced → intent was executed
const nonce = await adapter.nextNonceByXrplAccount(xrplAccount);
console.log("nonce:", nonce.toString()); // should be 1 after first deposit

// Get the deterministic proxy address
const proxy = await proxyFactory.proxyOf(xrplAccount);

// Check sXRP cToken balance
const sXRP = new ethers.Contract(MARKET_ADDRESS, [...], provider);
const balance = await sXRP.balanceOf(proxy);
console.log("sXRP balance:", balance.toString());

// Compute underlying value
const rate = await sXRP.exchangeRateStored();
const underlyingXRP = (balance * rate) / BigInt(10 ** 18);
console.log("underlying XRP (wei):", underlyingXRP.toString());
console.log("underlying XRP:", ethers.formatEther(underlyingXRP), "XRP");
```

---

## 9. Supported Actions and Future Flows

### SUPPLY (implemented and tested)

Send XRP from XRPL Ledger → minted as sXRP collateral in user's proxy on XRPL EVM.  
Script: `scripts/submitXrplDeposit.ts`

### REPAY (implementation ready, not yet tested)

Same flow as SUPPLY (`interchain_transfer` + payload), but `actionType = 2` in the envelope. The adapter calls `cToken.repayBorrow(amount)` instead of `mint`. Script changes are minimal — just change the actionType.

### BORROW and WITHDRAW (GMP path, not yet tested)

These use the `call_contract` GMP path (no token transfer from XRPL). The user sends an XRPL Payment with `type = call_contract` memos and a `SignedIntent` payload. The adapter calls `cToken.borrow()` or `cToken.redeemUnderlying()` on the user's proxy, then sends the resulting tokens back to XRPL via `ITS.interchainTransfer()`.

### Memo encoding rules (applies to all actions)

| Memo key | MemoType | MemoData |
|---|---|---|
| `type` | UTF-8 → hex | UTF-8 → hex |
| `destination_chain` | UTF-8 → hex | UTF-8 → hex |
| `destination_address` | UTF-8 → hex | UTF-8 hex of address **without `0x`** |
| `gas_fee_amount` | UTF-8 → hex | UTF-8 hex of decimal string |
| `payload` | UTF-8 → hex | **Raw ABI bytes as hex** (not UTF-8) |

---

## Common Errors Reference

| Error | Where seen | Root cause | Fix |
|---|---|---|---|
| `EstimationReverted` / `CANNOT_EXECUTE_MESSAGE/V2` | Axelarscan child message | Adapter `executeWithInterchainToken` reverts during relay simulation | See below |
| `NotGateway` | Axelarscan | `msg.sender != gateway` guard in `execute()` | Remove it — relayer calls from its own EOA |
| `UntrustedSource` | Axelarscan | Empty `trustedGmpSource` or `trustedItsSource` mapping | Remove guards — use intent signature for auth |
| `AmountMismatch` | Axelarscan | `envelope.amount` in drops, ITS delivers in EVM wei | Multiply drops by `10^12` before putting in envelope |
| `IntentSignerNotConfigured` | Axelarscan | `setIntentSigner` not called for this XRPL account | Call `adapter.setIntentSigner(xrplAccount, signer)` |
| `InvalidIntentSignature` | Axelarscan | Wrong key used to sign, or wrong `adapterAddress` / `chainId` in digest | Verify signer matches `intentSignerOfXrplAccount` |
| `InvalidNonce` | Axelarscan | Stale nonce in envelope | Read `adapter.nextNonceByXrplAccount(xrplAccount)` fresh |
| `MarketNotListed` | Axelarscan | `adapter.setMarket` not called for this cToken | Call `setMarket(cToken, underlying, tokenId, true)` |
| `TransferFailed` | Axelarscan | Adapter has insufficient XRP ERC20 balance | ITS mint failed — check token manager authorization |
| Relay returns `void` not `bytes32` | ITS revert | `executeWithInterchainToken` declared without return type | Add `returns (bytes32)` and `return ITS_EXECUTE_SUCCESS` |
| Transaction not indexed | Axelarscan | Wrong `destination_chain` value | Must be exactly `"xrpl-evm"` for XRPL EVM testnet |
| Payment not picked up | Nothing on Axelarscan | Wrong XRPL gateway address | Must be `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |
