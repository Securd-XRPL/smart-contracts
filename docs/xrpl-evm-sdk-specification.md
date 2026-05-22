# XRPL→EVM Bridge SDK — Full Technical Specification

**Version:** 0.1 (Draft)  
**Date:** 2026-05-22  
**Status:** Specification — not yet implemented  
**Context:** Derived from production experience building the Securd cross-chain lending adapter on XRPL EVM via Axelar.

---

## 1. Executive Summary

This SDK enables any XRPL Ledger user to interact with **any smart contract on any Axelar-connected EVM chain** (starting with XRPL EVM) directly from their XRPL wallet — without holding EVM gas tokens, without bridging assets manually, and without any modification to the target EVM protocol.

The user experience is:
1. User opens a dapp on XRPL
2. Signs a structured intent with their XRPL wallet (no EVM private key needed)
3. The SDK submits the intent via Axelar GMP or ITS
4. A generic on-chain adapter on XRPL EVM executes the calldata on behalf of the user through their deterministic proxy
5. If the action produces tokens (borrow, swap output, withdrawal), the adapter automatically bridges them back to the user's XRPL address

**Key guarantee:** Zero changes required to existing EVM protocols. The adapter calls their public interfaces through a per-user proxy.

---

## 2. Background and Lessons from Securd

### 2.1 What Securd Built

Securd implemented this pattern for Compound V2 specifically:

```
XRPL Wallet → sign IntentEnvelope → Axelar GMP/ITS → XRPLSecurdBridgeAdapter
  → validates signature + nonce → XRPLUserProxy → Compound V2 (mint/borrow/repay/redeem)
  → if egress needed → ITS interchainTransfer → XRPL Wallet
```

The adapter works. The architecture is sound.

### 2.2 What Makes It Protocol-Specific Today

Only two things tie the Securd adapter to Compound V2:

1. **The `IntentEnvelope` struct** encodes `actionType` (SUPPLY=0, BORROW=1…) — a Compound concept
2. **The adapter's action handlers** contain switch-case logic that knows Compound's function selectors

Everything else is already generic:
- Intent signature validation (ECDSA)
- Nonce management per XRPL account
- Session key (intent signer) per XRPL account
- `XRPLUserProxyFactory` — CREATE2 proxy per user
- `XRPLUserProxy` — dumb forwarder controlled by adapter
- Axelar GMP ingress (`execute`)
- Axelar ITS ingress (`executeWithInterchainToken`)
- Egress via `interchainTransfer`

### 2.3 Known Bugs to Fix Before SDK

| Bug | Location | Impact |
|-----|----------|--------|
| Native XRP egress broken | `_egress()` in adapter | BORROW/WITHDRAW of native token fail to bridge back |
| No "repay all" sentinel | `_repay()` | Cannot clear debt including accrued interest |
| No "withdraw all" sentinel | `_withdraw()` | Cannot exit full position due to exchange rate drift |
| Adapter not upgradeable | Deployment | Cannot fix bugs without losing user data |

All four must be resolved before SDK v1.0.

---

## 3. Goals and Non-Goals

### Goals

- Any XRPL user can interact with any EVM contract without an EVM wallet
- Zero modifications to target EVM protocols
- Generic intent format supporting arbitrary calldata
- Automatic token egress detection and bridging
- TypeScript SDK with protocol-specific helper modules
- Upgradeable on-chain adapter (UUPS)
- Production-grade security: signature verification, replay protection, slippage protection

### Non-Goals

- Supporting non-EVM chains as the execution target (scope: EVM only)
- Replacing Axelar's cross-chain infrastructure (the SDK sits on top of it)
- Abstracting XRPL wallet signing beyond existing XRPL wallet libraries
- MEV protection or order routing

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  XRPL LEDGER                                                    │
│                                                                 │
│  User XRPL Wallet (rPpam...)                                    │
│       │                                                         │
│  SDK Client (TypeScript)                                        │
│  ├── IntentBuilder        builds generic intent envelope        │
│  ├── IntentSigner         signs with XRPL session key (ECDSA)   │
│  ├── AxelarSubmitter      sends GMP or ITS transaction to XRPL  │
│  └── protocol/            encodes protocol-specific calldata    │
│       ├── compound.ts                                           │
│       ├── uniswap.ts                                            │
│       └── aave.ts                                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Axelar GMP (call_contract)
                               │    or
                               │ Axelar ITS (interchain_transfer + payload)
┌──────────────────────────────▼──────────────────────────────────┐
│  XRPL EVM (or any EVM chain)                                    │
│                                                                 │
│  XRPLBridgeAdapter (UUPS upgradeable, generic)                  │
│  ├── validates intent signature                                 │
│  ├── checks nonce + deadline                                    │
│  ├── routes to XRPLUserProxy via factory                        │
│  ├── executes raw calldata through proxy                        │
│  └── detects token delta → bridges back via ITS egress          │
│                                                                 │
│  XRPLUserProxyFactory                                           │
│  └── XRPLUserProxy (one per XRPL account, CREATE2)             │
│           │                                                     │
│           ▼                                                     │
│  Any EVM Protocol  ← called via proxy, ZERO modifications       │
│  Compound V2 / Aave / Uniswap V3 / Curve / ERC-20 / …         │
└─────────────────────────────────────────────────────────────────┘
                               │ Axelar ITS (egress)
                               ▼
                        User XRPL Wallet  ← tokens returned
```

---

## 5. On-Chain Components

### 5.1 Generic Intent Envelope

The core data structure carried in every cross-chain message. Replaces the Securd `IntentEnvelope` with a protocol-agnostic version.

```solidity
struct IntentEnvelope {
    bytes32 intentId;           // unique ID, keccak256(xrplAccount + nonce + deadline)
    bytes32 xrplAccount;        // sender: keccak256(xrplAddress as UTF-8)
    address target;             // contract to call on XRPL EVM
    bytes   callData;           // ABI-encoded calldata for target
    address tokenIn;            // token bridged from XRPL (address(0) if GMP-only)
    uint256 amountIn;           // amount bridged in (0 if GMP-only)
    address tokenOut;           // token expected back (address(0) if no egress)
    uint256 minAmountOut;       // minimum tokens out (slippage protection, 0 = no check)
    bytes   destinationAddress; // XRPL address for egress (raw bytes, UTF-8 encoded)
    uint64  nonce;              // monotonically increasing per xrplAccount
    uint64  deadline;           // unix timestamp — intent expires after this
    uint16  version;            // envelope version = 1
}

struct SignedIntent {
    IntentEnvelope envelope;
    bytes          signature;   // ECDSA over keccak256(ABI-encoded envelope)
}
```

**Sentinel values:**
| Field | Sentinel | Meaning |
|-------|---------|---------|
| `tokenIn` | `address(0)` | No token bridged in — GMP-only intent |
| `tokenOut` | `address(0)` | No egress needed — adapter keeps any output |
| `minAmountOut` | `0` | No slippage check |
| `amountIn` | `type(uint256).max` | Use full token amount received by ITS (for repay-all) |
| `tokenIn` | `0xEeee...EEeE` | Native token (XRP on XRPL EVM) |
| `tokenOut` | `0xEeee...EEeE` | Native token egress back to XRPL |

---

### 5.2 XRPLBridgeAdapter (Generic, UUPS Upgradeable)

Replaces `XRPLSecurdBridgeAdapter`. All protocol-specific logic is removed. The adapter executes whatever calldata is in the intent.

#### 5.2.1 Storage Layout

```solidity
contract XRPLBridgeAdapter is UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {

    // Axelar
    IAxelarGateway             public gateway;
    IInterchainTokenService    public interchainTokenService;
    string                     public destinationChain;   // "xrpl"

    // Proxy factory
    XRPLUserProxyFactory       public proxyFactory;

    // Intent signer registry — one EVM session key per XRPL account
    mapping(bytes32 => address) public intentSignerOf;

    // Nonce registry — strictly monotonic per XRPL account
    mapping(bytes32 => uint64)  public nextNonce;

    // Replay protection — intentId → payloadHash, set on first execution
    mapping(bytes32 => bytes32) public usedIntents;

    // Trusted Axelar sources
    mapping(bytes32 => bool)    public trustedGmpSource;
    mapping(bytes32 => bool)    public trustedItsSource;

    // Token allowlist — only whitelisted targets can be called
    mapping(address => bool)    public allowedTargets;

    // Egress gas budget (paid in native token per cross-chain call back)
    uint256                     public egressGasValue;

    uint16 public constant ENVELOPE_VERSION = 1;
}
```

#### 5.2.2 Ingress: GMP Path (no token transfer)

Called by Axelar relayer when the user sent `call_contract` from XRPL (no tokens — used for borrow, withdraw, enter/exit market, or any non-token-in action).

```solidity
function execute(
    bytes32 commandId,
    string  calldata sourceChain,
    string  calldata sourceAddress,
    bytes   calldata payload
) external whenNotPaused {
    // 1. Validate Axelar approval
    if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, keccak256(payload)))
        revert NotApprovedByGateway();

    // 2. Check trusted source
    bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
    if (!trustedGmpSource[sourceId]) revert UntrustedSource(sourceId);

    // 3. Decode + validate intent
    SignedIntent memory si = abi.decode(payload, (SignedIntent));
    _validateAndExecute(si, address(0), 0);
}
```

#### 5.2.3 Ingress: ITS Path (token transfer + calldata)

Called by Axelar ITS when the user sent `interchain_transfer` from XRPL with a payload (used for supply, swap-in, deposit, or any token-in action).

```solidity
function executeWithInterchainToken(
    bytes32 commandId,
    string  calldata sourceChain,
    bytes   calldata sourceAddress,
    bytes   calldata data,
    bytes32 tokenId,
    address token,
    uint256 amount
) external whenNotPaused returns (bytes32) {
    if (msg.sender != address(interchainTokenService)) revert NotInterchainTokenService();

    bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
    if (!trustedItsSource[sourceId]) revert UntrustedSource(sourceId);

    SignedIntent memory si = abi.decode(data, (SignedIntent));

    // Verify the ITS token matches what the intent declared
    if (si.envelope.tokenIn != token) revert TokenMismatch(si.envelope.tokenIn, token);

    // If amountIn == max, use the actual received amount (repay-all pattern)
    uint256 effectiveAmount = si.envelope.amountIn == type(uint256).max ? amount : si.envelope.amountIn;
    if (effectiveAmount != amount) revert AmountMismatch(amount, effectiveAmount);

    _validateAndExecute(si, token, amount);
    return ITS_EXECUTE_SUCCESS;
}
```

#### 5.2.4 Core Execution Engine

```solidity
function _validateAndExecute(
    SignedIntent memory si,
    address             tokenIn,
    uint256             amountIn
) internal {
    IntentEnvelope memory e = si.envelope;

    // Version
    if (e.version != ENVELOPE_VERSION) revert UnsupportedVersion(e.version, ENVELOPE_VERSION);

    // Basic field validation
    if (e.intentId == bytes32(0))        revert InvalidIntentId();
    if (e.xrplAccount == bytes32(0))     revert InvalidXrplAccount();
    if (e.target == address(0))          revert InvalidTarget();
    if (e.deadline < block.timestamp)    revert DeadlineExpired(e.deadline, block.timestamp);
    if (!allowedTargets[e.target])       revert TargetNotAllowed(e.target);

    // Signature
    address signer = intentSignerOf[e.xrplAccount];
    if (signer == address(0)) revert IntentSignerNotConfigured(e.xrplAccount);
    bytes32 digest = keccak256(abi.encode(e));
    address recovered = ECDSA.recover(digest, si.signature);
    if (recovered != signer) revert InvalidIntentSignature(e.xrplAccount, signer, recovered);

    // Replay protection
    bytes32 payloadHash = keccak256(abi.encode(si));
    if (usedIntents[e.intentId] != bytes32(0)) {
        emit IntentDuplicateIgnored(e.intentId, payloadHash);
        return;
    }
    usedIntents[e.intentId] = payloadHash;

    // Nonce
    uint64 expected = nextNonce[e.xrplAccount];
    if (e.nonce != expected) revert InvalidNonce(e.nonce, expected);
    nextNonce[e.xrplAccount] = expected + 1;

    // Get or create user proxy
    address proxy = proxyFactory.getOrCreateProxy(e.xrplAccount);

    // Transfer tokenIn to proxy if ITS path
    if (tokenIn != address(0) && amountIn > 0) {
        IERC20(tokenIn).safeTransfer(proxy, amountIn);
    }

    // Snapshot proxy balance of tokenOut before execution
    uint256 balanceBefore = _proxyTokenBalance(proxy, e.tokenOut);

    // Execute calldata through proxy
    _proxyCall(proxy, e.target, e.callData);

    // Compute actual output
    uint256 balanceAfter = _proxyTokenBalance(proxy, e.tokenOut);
    uint256 actualOut    = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

    // Slippage check
    if (e.minAmountOut > 0 && actualOut < e.minAmountOut)
        revert SlippageExceeded(e.minAmountOut, actualOut);

    // Egress: bridge actualOut back to XRPL if tokenOut is declared
    if (e.tokenOut != address(0) && actualOut > 0 && e.destinationAddress.length > 0) {
        _egress(proxy, e, actualOut);
    }

    emit IntentExecuted(
        e.intentId, e.xrplAccount, proxy,
        e.target, actualOut, tokenIn != address(0)
    );
}
```

#### 5.2.5 Proxy Execution

```solidity
function _proxyCall(address proxy, address target, bytes memory data) internal {
    (bool ok, bytes memory result) = XRPLUserProxy(proxy).execute(target, data);
    if (!ok) {
        if (result.length == 0) revert ProxyCallFailed(target);
        assembly { revert(add(result, 0x20), mload(result)) }
    }
}
```

#### 5.2.6 Egress (Fixed Native Token Handling)

```solidity
function _egress(
    address proxy,
    IntentEnvelope memory e,
    uint256 actualOut
) internal {
    bool isNative = (e.tokenOut == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE));

    if (isNative) {
        // Pull native token from proxy via low-level call
        (bool ok,) = XRPLUserProxy(proxy).executeValue(address(this), actualOut, "");
        if (!ok) revert NativeTransferFailed();

        // Bridge back: value = actual amount + gas
        interchainTokenService.interchainTransfer{value: actualOut + egressGasValue}(
            _nativeTokenId(),
            destinationChain,
            e.destinationAddress,
            actualOut,
            bytes(""),
            egressGasValue
        );
    } else {
        // Pull ERC-20 from proxy
        _proxyTokenCall(proxy, e.tokenOut,
            abi.encodeWithSelector(IERC20.transfer.selector, address(this), actualOut));

        // Approve ITS
        IERC20(e.tokenOut).safeApprove(address(interchainTokenService), actualOut);

        interchainTokenService.interchainTransfer{value: egressGasValue}(
            _tokenIdOf(e.tokenOut),
            destinationChain,
            e.destinationAddress,
            actualOut,
            bytes(""),
            egressGasValue
        );

        IERC20(e.tokenOut).safeApprove(address(interchainTokenService), 0);
    }

    emit EgressInitiated(
        e.intentId, e.xrplAccount,
        isNative ? _nativeTokenId() : _tokenIdOf(e.tokenOut),
        destinationChain, e.destinationAddress, actualOut, egressGasValue
    );
}
```

#### 5.2.7 Admin Functions

```solidity
// Register session key for a XRPL account
function setIntentSigner(bytes32 xrplAccount, address signer) external onlyOwner;

// Add/remove allowed target contracts
function setAllowedTarget(address target, bool allowed) external onlyOwner;

// Register Axelar trusted source
function setTrustedGmpSource(string calldata chain, string calldata addr, bool trusted) external onlyOwner;
function setTrustedItsSource(string calldata chain, bytes calldata addr, bool trusted) external onlyOwner;

// Emergency pause
function pause() external onlyOwner;
function unpause() external onlyOwner;

// UUPS upgrade (owner only)
function _authorizeUpgrade(address newImplementation) internal override onlyOwner;

// Token rescue (stuck funds)
function rescueToken(address token, address to, uint256 amount) external onlyOwner;

// Fund egress gas
receive() external payable;
```

---

### 5.3 XRPLUserProxy (Updated)

The proxy gains a `executeValue` method to allow the adapter to pull native tokens:

```solidity
contract XRPLUserProxy {
    address public immutable controller;
    bytes32 public immutable xrplAccount;

    error NotController();

    constructor(address controller_, bytes32 xrplAccount_) {
        controller  = controller_;
        xrplAccount = xrplAccount_;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    // Execute arbitrary calldata on any target
    function execute(address target, bytes calldata data)
        external onlyController returns (bool, bytes memory)
    {
        return target.call(data);
    }

    // Execute with value (for native token pulls)
    function executeValue(address target, uint256 value, bytes calldata data)
        external onlyController returns (bool, bytes memory)
    {
        return target.call{value: value}(data);
    }

    // Accept native token (XRP) from cToken redeem or direct transfers
    receive() external payable {}
}
```

---

### 5.4 XRPLUserProxyFactory (Unchanged)

No changes needed. The factory is already generic — it creates one proxy per XRPL account using CREATE2. The `controller` it records is the adapter's proxy address (UUPS), which never changes even across implementation upgrades.

```solidity
// Already correct — no changes
function getOrCreateProxy(bytes32 xrplAccount) external onlyController returns (address proxy);
function predictProxy(bytes32 xrplAccount) external view returns (address predicted);
```

---

### 5.5 Security Model

#### Target Allowlist

The adapter maintains `allowedTargets: mapping(address => bool)`. Only whitelisted contracts can be called through user proxies. This prevents:
- Drain attacks (malicious intent calling `IERC20.transfer` from proxy to attacker)
- Arbitrary delegatecall attacks
- Calling the adapter itself or the proxy factory

The SDK documentation must clearly state that integrators must request target allowlisting from the adapter owner before going live.

#### Signature Replay Protection

Two-layer protection:
1. `usedIntents[intentId]` — set on first execution, prevents exact replay
2. `nextNonce[xrplAccount]` — strictly monotonic, prevents out-of-order replay

#### Deadline

Every intent carries a `deadline` (unix timestamp). Expired intents revert. The client should set deadline = `now + 5 minutes` to account for Axelar relay latency (~30s–90s on testnet).

#### Slippage

`minAmountOut` allows the user to specify a minimum expected output. If the actual output is less (e.g., price moved, protocol fee increased), the transaction reverts. The client should compute this from a freshly read state before submitting.

#### Session Key Model

The user does not expose their XRPL master private key. Instead:
1. The dapp generates an ephemeral EVM keypair (the "session key")
2. The user's XRPL master key signs a one-time message registering the session key with the adapter via `setIntentSigner`
3. All subsequent intents are signed only with the session key
4. The session key can be rotated or revoked at any time via another signed `setIntentSigner` call

---

## 6. Off-Chain SDK Components (TypeScript)

### 6.1 Package Structure

```
@securd/xrpl-evm-sdk
├── src/
│   ├── core/
│   │   ├── IntentBuilder.ts       builds + encodes IntentEnvelope
│   │   ├── IntentSigner.ts        ECDSA signing with session key
│   │   ├── AxelarSubmitter.ts     submits GMP or ITS tx on XRPL
│   │   ├── ProxyAddress.ts        predicts CREATE2 proxy address off-chain
│   │   └── types.ts               TypeScript interfaces
│   ├── protocol/
│   │   ├── compound.ts            Compound V2 calldata helpers
│   │   ├── uniswap.ts             Uniswap V3 calldata helpers
│   │   └── aave.ts                Aave V3 calldata helpers
│   ├── xrpl/
│   │   ├── wallet.ts              XRPL wallet abstraction
│   │   └── memos.ts               XRPL memo encoding/decoding
│   └── index.ts
```

---

### 6.2 Core: IntentBuilder

```typescript
import { ethers } from "ethers";

export interface IntentEnvelope {
  intentId:           string;   // bytes32 hex
  xrplAccount:        string;   // bytes32 hex
  target:             string;   // EVM address
  callData:           string;   // hex-encoded ABI calldata
  tokenIn:            string;   // EVM address or ZERO_ADDRESS
  amountIn:           bigint;
  tokenOut:           string;   // EVM address or ZERO_ADDRESS
  minAmountOut:       bigint;
  destinationAddress: Uint8Array; // UTF-8 encoded XRPL address
  nonce:              bigint;
  deadline:           bigint;
  version:            number;   // always 1
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const NATIVE_TOKEN  = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const REPAY_ALL     = ethers.MaxUint256;
export const WITHDRAW_ALL  = 0n;

const ENVELOPE_ABI_TYPES = [
  "bytes32", // intentId
  "bytes32", // xrplAccount
  "address", // target
  "bytes",   // callData
  "address", // tokenIn
  "uint256", // amountIn
  "address", // tokenOut
  "uint256", // minAmountOut
  "bytes",   // destinationAddress
  "uint64",  // nonce
  "uint64",  // deadline
  "uint16",  // version
];

export class IntentBuilder {
  static xrplAccountToBytes32(xrplAddress: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(xrplAddress));
  }

  static buildIntentId(xrplAccount: string, nonce: bigint, deadline: bigint): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint64", "uint64"],
        [xrplAccount, nonce, deadline]
      )
    );
  }

  static encode(envelope: IntentEnvelope): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ENVELOPE_ABI_TYPES,
      [
        envelope.intentId,
        envelope.xrplAccount,
        envelope.target,
        envelope.callData,
        envelope.tokenIn,
        envelope.amountIn,
        envelope.tokenOut,
        envelope.minAmountOut,
        envelope.destinationAddress,
        envelope.nonce,
        envelope.deadline,
        envelope.version,
      ]
    );
  }

  static digest(envelope: IntentEnvelope): string {
    return ethers.keccak256(IntentBuilder.encode(envelope));
  }

  /** Build a complete envelope ready for signing */
  static build(params: {
    xrplAddress:        string;
    target:             string;
    callData:           string;
    tokenIn?:           string;
    amountIn?:          bigint;
    tokenOut?:          string;
    minAmountOut?:      bigint;
    destinationAddress?: string; // XRPL address for egress
    nonce:              bigint;
    deadlineSeconds?:   number;  // default: 300 (5 min)
  }): IntentEnvelope {
    const xrplAccount  = IntentBuilder.xrplAccountToBytes32(params.xrplAddress);
    const deadline     = BigInt(Math.floor(Date.now() / 1000)) +
                         BigInt(params.deadlineSeconds ?? 300);
    const intentId     = IntentBuilder.buildIntentId(xrplAccount, params.nonce, deadline);
    const destBytes    = params.destinationAddress
      ? ethers.toUtf8Bytes(params.destinationAddress)
      : new Uint8Array(0);

    return {
      intentId,
      xrplAccount,
      target:             params.target,
      callData:           params.callData,
      tokenIn:            params.tokenIn  ?? ZERO_ADDRESS,
      amountIn:           params.amountIn ?? 0n,
      tokenOut:           params.tokenOut ?? ZERO_ADDRESS,
      minAmountOut:       params.minAmountOut ?? 0n,
      destinationAddress: destBytes,
      nonce:              params.nonce,
      deadline,
      version:            1,
    };
  }
}
```

---

### 6.3 Core: IntentSigner

```typescript
import { ethers } from "ethers";
import { IntentEnvelope, IntentBuilder } from "./IntentBuilder";

export interface SignedIntent {
  envelope:  IntentEnvelope;
  signature: string; // hex
}

export class IntentSigner {
  private sessionKey: ethers.Wallet;

  constructor(sessionKeyPrivateKey: string) {
    this.sessionKey = new ethers.Wallet(sessionKeyPrivateKey);
  }

  get address(): string {
    return this.sessionKey.address;
  }

  async sign(envelope: IntentEnvelope): Promise<SignedIntent> {
    const digest    = IntentBuilder.digest(envelope);
    // Raw ECDSA (not EIP-191 prefixed) — adapter uses ECDSA.recover on raw digest
    const signature = await this.sessionKey.signMessage(ethers.getBytes(digest));
    return { envelope, signature };
  }

  /** ABI-encode a SignedIntent for embedding in a GMP payload or ITS data field */
  static encode(signedIntent: SignedIntent): string {
    const SIGNED_INTENT_TUPLE =
      "tuple(tuple(bytes32,bytes32,address,bytes,address,uint256,address,uint256,bytes,uint64,uint64,uint16),bytes)";
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [SIGNED_INTENT_TUPLE],
      [[
        [
          signedIntent.envelope.intentId,
          signedIntent.envelope.xrplAccount,
          signedIntent.envelope.target,
          signedIntent.envelope.callData,
          signedIntent.envelope.tokenIn,
          signedIntent.envelope.amountIn,
          signedIntent.envelope.tokenOut,
          signedIntent.envelope.minAmountOut,
          signedIntent.envelope.destinationAddress,
          signedIntent.envelope.nonce,
          signedIntent.envelope.deadline,
          signedIntent.envelope.version,
        ],
        signedIntent.signature,
      ]]
    );
  }
}
```

---

### 6.4 Core: AxelarSubmitter

Handles sending both GMP (`call_contract`) and ITS (`interchain_transfer`) transactions from XRPL Ledger. Encodes memos in the format the Axelar XRPL relayer expects.

```typescript
import { Client, Payment, Wallet } from "xrpl";
import { SignedIntent, IntentSigner } from "./IntentSigner";

export type BridgeMode = "GMP" | "ITS";

export interface SubmitParams {
  signedIntent:     SignedIntent;
  xrplWallet:       Wallet;          // XRPL master wallet
  xrplClient:       Client;
  bridgeMode:       BridgeMode;
  xrplTokenAmount?: string;          // drops of XRP (ITS only)
  xrplGateway:      string;          // Axelar gateway XRPL address
  axelarChainName:  string;          // e.g. "xrpl-evm"
  adapterAddress:   string;          // EVM adapter address (destination contract)
  gasValue?:        string;          // drops for Axelar gas (default: "2000000" = 2 XRP)
}

function toMemoHex(value: string): string {
  return Buffer.from(value.startsWith("0x") ? value.slice(2) : value, "utf8")
    .toString("hex").toUpperCase();
}

function payloadMemoHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toUpperCase();
}

export class AxelarSubmitter {
  static buildMemos(params: SubmitParams): any[] {
    const encodedPayload = IntentSigner.encode(params.signedIntent);
    const memos: any[] = [
      {
        Memo: {
          MemoType: toMemoHex("type"),
          MemoData: toMemoHex(params.bridgeMode === "ITS" ? "interchain_transfer" : "call_contract"),
        },
      },
      {
        Memo: {
          MemoType: toMemoHex("destination_chain"),
          MemoData: toMemoHex(params.axelarChainName),
        },
      },
      {
        Memo: {
          MemoType: toMemoHex("destination_address"),
          MemoData: toMemoHex(params.adapterAddress),
        },
      },
      {
        Memo: {
          MemoType: toMemoHex("payload"),
          MemoData: payloadMemoHex(encodedPayload),
        },
      },
    ];

    if (params.bridgeMode === "ITS") {
      memos.push({
        Memo: {
          MemoType: toMemoHex("gas_fee_amount"),
          MemoData: toMemoHex(params.gasValue ?? "2000000"),
        },
      });
    }

    return memos;
  }

  static async submit(params: SubmitParams): Promise<string> {
    const memos = AxelarSubmitter.buildMemos(params);

    const tx: Payment = {
      TransactionType: "Payment",
      Account:         params.xrplWallet.address,
      Destination:     params.xrplGateway,
      Amount:          params.bridgeMode === "ITS"
                         ? params.xrplTokenAmount ?? "0"
                         : "1", // dust for GMP (1 drop)
      Memos:           memos,
    };

    const prepared = await params.xrplClient.autofill(tx);
    const signed   = params.xrplWallet.sign(prepared);
    const result   = await params.xrplClient.submitAndWait(signed.tx_blob);

    if ((result.result.meta as any)?.TransactionResult !== "tesSUCCESS") {
      throw new Error(`XRPL transaction failed: ${JSON.stringify(result.result.meta)}`);
    }

    return signed.hash;
  }
}
```

---

### 6.5 Protocol Module: Compound V2

```typescript
import { ethers } from "ethers";
import { IntentBuilder, ZERO_ADDRESS, NATIVE_TOKEN, REPAY_ALL, WITHDRAW_ALL } from "../core/IntentBuilder";

const CTOKEN_IFACE = new ethers.Interface([
  "function mint(uint256 mintAmount) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function borrow(uint256 borrowAmount) returns (uint256)",
  "function repayBorrow(uint256 repayAmount) returns (uint256)",
]);

const COMPTROLLER_IFACE = new ethers.Interface([
  "function enterMarkets(address[] calldata cTokens) returns (uint256[] memory)",
  "function exitMarket(address cToken) returns (uint256)",
]);

export interface CompoundParams {
  xrplAddress:       string;
  cTokenAddress:     string;          // e.g. cXRP address on XRPL EVM
  underlyingAddress: string;          // underlying token address
  comptroller:       string;          // Comptroller/Unitroller address
  nonce:             bigint;
  destinationXrpl?:  string;          // user's XRPL address for egress
}

export const CompoundV2 = {
  /** Supply underlying → mint cTokens (ITS path) */
  supply(params: CompoundParams & { amount: bigint }) {
    return IntentBuilder.build({
      xrplAddress: params.xrplAddress,
      target:      params.cTokenAddress,
      callData:    CTOKEN_IFACE.encodeFunctionData("mint", [params.amount]),
      tokenIn:     params.underlyingAddress,
      amountIn:    params.amount,
      nonce:       params.nonce,
    });
  },

  /** Borrow underlying → bridge back to XRPL (GMP path) */
  borrow(params: CompoundParams & { amount: bigint }) {
    return IntentBuilder.build({
      xrplAddress:        params.xrplAddress,
      target:             params.cTokenAddress,
      callData:           CTOKEN_IFACE.encodeFunctionData("borrow", [params.amount]),
      tokenOut:           params.underlyingAddress,
      minAmountOut:       params.amount,
      destinationAddress: params.destinationXrpl,
      nonce:              params.nonce,
    });
  },

  /** Repay exact amount (ITS path) */
  repay(params: CompoundParams & { amount: bigint }) {
    return IntentBuilder.build({
      xrplAddress: params.xrplAddress,
      target:      params.cTokenAddress,
      callData:    CTOKEN_IFACE.encodeFunctionData("repayBorrow", [params.amount]),
      tokenIn:     params.underlyingAddress,
      amountIn:    params.amount,
      nonce:       params.nonce,
    });
  },

  /**
   * Repay all outstanding debt (ITS path).
   * Client must query borrowBalanceCurrent and send at least that amount via ITS.
   * amountIn = actual amount sent; contract passes type(uint256).max to repayBorrow.
   */
  repayAll(params: CompoundParams & { currentBorrowBalance: bigint }) {
    return IntentBuilder.build({
      xrplAddress: params.xrplAddress,
      target:      params.cTokenAddress,
      // type(uint256).max signals "repay all" to the protocol helper on the cToken
      callData:    CTOKEN_IFACE.encodeFunctionData("repayBorrow", [REPAY_ALL]),
      tokenIn:     params.underlyingAddress,
      amountIn:    REPAY_ALL,  // adapter uses actual ITS amount for transfer
      nonce:       params.nonce,
    });
  },

  /** Withdraw exact amount (GMP path) */
  withdraw(params: CompoundParams & { amount: bigint }) {
    return IntentBuilder.build({
      xrplAddress:        params.xrplAddress,
      target:             params.cTokenAddress,
      callData:           CTOKEN_IFACE.encodeFunctionData("redeemUnderlying", [params.amount]),
      tokenOut:           params.underlyingAddress,
      minAmountOut:       params.amount,
      destinationAddress: params.destinationXrpl,
      nonce:              params.nonce,
    });
  },

  /**
   * Withdraw all (GMP path).
   * Uses redeem(cTokenBalance) — adapter reads cToken balance at execution time.
   * amountOut is detected via balance delta.
   */
  withdrawAll(params: CompoundParams & { minExpectedOut: bigint }) {
    return IntentBuilder.build({
      xrplAddress:        params.xrplAddress,
      target:             params.cTokenAddress,
      // The SDK encodes redeem(0) as the sentinel — adapter detects WITHDRAW_ALL
      // and substitutes redeem(cTokenBalance) internally
      callData:           CTOKEN_IFACE.encodeFunctionData("redeem", [WITHDRAW_ALL]),
      tokenOut:           params.underlyingAddress,
      minAmountOut:       params.minExpectedOut,
      destinationAddress: params.destinationXrpl,
      nonce:              params.nonce,
    });
  },

  /** Enable cToken as collateral (GMP path) */
  enterMarket(params: CompoundParams) {
    return IntentBuilder.build({
      xrplAddress: params.xrplAddress,
      target:      params.comptroller,
      callData:    COMPTROLLER_IFACE.encodeFunctionData("enterMarkets", [[params.cTokenAddress]]),
      nonce:       params.nonce,
    });
  },

  /** Disable cToken as collateral (GMP path) */
  exitMarket(params: CompoundParams) {
    return IntentBuilder.build({
      xrplAddress: params.xrplAddress,
      target:      params.comptroller,
      callData:    COMPTROLLER_IFACE.encodeFunctionData("exitMarket", [params.cTokenAddress]),
      nonce:       params.nonce,
    });
  },
};
```

---

### 6.6 Protocol Module: Uniswap V3 (Example of Generic Power)

This shows how the same SDK supports a completely different protocol with no changes to the on-chain adapter:

```typescript
import { ethers } from "ethers";
import { IntentBuilder, NATIVE_TOKEN } from "../core/IntentBuilder";

const SWAP_ROUTER_IFACE = new ethers.Interface([
  `function exactInputSingle(
    (address tokenIn, address tokenOut, uint24 fee, address recipient,
     uint256 deadline, uint256 amountIn, uint256 amountOutMinimum,
     uint160 sqrtPriceLimitX96)
  ) returns (uint256 amountOut)`,
]);

export const UniswapV3 = {
  /**
   * Swap tokenIn for tokenOut on XRPL EVM via Uniswap V3.
   * User sends tokenIn from XRPL via ITS, receives tokenOut back on XRPL.
   */
  swapExactIn(params: {
    xrplAddress:      string;
    routerAddress:    string;
    tokenIn:          string;
    tokenOut:         string;
    fee:              number;        // pool fee tier: 500, 3000, 10000
    amountIn:         bigint;
    minAmountOut:     bigint;
    destinationXrpl:  string;
    nonce:            bigint;
  }) {
    const proxyAddress = "..."; // computed off-chain via predictProxy()
    const callData = SWAP_ROUTER_IFACE.encodeFunctionData("exactInputSingle", [{
      tokenIn:             params.tokenIn,
      tokenOut:            params.tokenOut,
      fee:                 params.fee,
      recipient:           proxyAddress,    // swap output lands in user proxy
      deadline:            BigInt(Math.floor(Date.now() / 1000) + 300),
      amountIn:            params.amountIn,
      amountOutMinimum:    params.minAmountOut,
      sqrtPriceLimitX96:   0n,
    }]);

    return IntentBuilder.build({
      xrplAddress:        params.xrplAddress,
      target:             params.routerAddress,
      callData,
      tokenIn:            params.tokenIn,
      amountIn:           params.amountIn,
      tokenOut:           params.tokenOut,
      minAmountOut:       params.minAmountOut,
      destinationAddress: params.destinationXrpl,
      nonce:              params.nonce,
    });
  },
};
```

---

### 6.7 ProxyAddress: Off-Chain CREATE2 Prediction

```typescript
import { ethers } from "ethers";

export class ProxyAddress {
  /**
   * Predict the deterministic proxy address for a given XRPL address
   * without any on-chain call.
   *
   * Must match XRPLUserProxyFactory.predictProxy() exactly.
   */
  static predict(params: {
    xrplAddress:      string;
    factoryAddress:   string;
    proxyBytecode:    string; // XRPLUserProxy creation bytecode
    controllerAddress: string; // adapter proxy address (UUPS proxy)
  }): string {
    const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(params.xrplAddress));
    const salt        = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [xrplAccount])
    );
    const initCode    = ethers.concat([
      params.proxyBytecode,
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [params.controllerAddress, xrplAccount]
      ),
    ]);
    const initCodeHash = ethers.keccak256(initCode);
    const hash = ethers.keccak256(
      ethers.concat(["0xff", params.factoryAddress, salt, initCodeHash])
    );
    return ethers.getAddress("0x" + hash.slice(-40));
  }
}
```

---

## 7. End-to-End Flow Examples

### 7.1 Compound V2 Supply (ITS Path)

```typescript
import { Client, Wallet } from "xrpl";
import { IntentSigner, AxelarSubmitter, CompoundV2 } from "@securd/xrpl-evm-sdk";

const xrplWallet  = Wallet.fromSeed(process.env.XRPL_SEED!);
const sessionKey  = new IntentSigner(process.env.SESSION_KEY!);

const envelope = CompoundV2.supply({
  xrplAddress:       xrplWallet.address,
  cTokenAddress:     "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",  // cXRP
  underlyingAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // native XRP
  comptroller:       "0x46d364257112230022E72b086Df85a6b0f8D3F86",
  nonce:             0n,
  amount:            ethers.parseEther("10"), // 10 XRP
});

const signedIntent = await sessionKey.sign(envelope);

const client = new Client("wss://s.altnet.rippletest.net:51233");
await client.connect();

const hash = await AxelarSubmitter.submit({
  signedIntent,
  xrplWallet,
  xrplClient:      client,
  bridgeMode:      "ITS",
  xrplTokenAmount: "10000000",   // 10 XRP in drops
  xrplGateway:     "r4GDFMLGJUKMjNEycSZGYGWjPeE3MVbFoR",
  axelarChainName: "xrpl-evm",
  adapterAddress:  "0x7AC8Df85448037c6fE1eD5732c6ca71060069237",
});

console.log("XRPL TX:", hash);
await client.disconnect();
```

### 7.2 Compound V2 Repay All (ITS Path with Sentinel)

```typescript
// 1. Read current borrow balance from XRPL EVM
const provider     = new ethers.JsonRpcProvider(process.env.RPC_URL);
const cToken       = new ethers.Contract(CXRP, ["function borrowBalanceCurrent(address) returns (uint256)"], provider);
const proxyAddress = ProxyAddress.predict({ xrplAddress, factoryAddress, proxyBytecode, controllerAddress });
const borrow       = await cToken.borrowBalanceCurrent(proxyAddress);

// 2. Build intent with REPAY_ALL sentinel
const envelope = CompoundV2.repayAll({
  xrplAddress,
  cTokenAddress:     CXRP,
  underlyingAddress: NATIVE_TOKEN,
  comptroller:       UNITROLLER,
  nonce:             currentNonce,
  currentBorrowBalance: borrow,
});

// 3. Sign and submit — send borrow amount via ITS
const signedIntent = await sessionKey.sign(envelope);
await AxelarSubmitter.submit({
  signedIntent,
  xrplWallet,
  xrplClient,
  bridgeMode:      "ITS",
  xrplTokenAmount: (borrow + parseEther("0.001")).toString(), // add tiny buffer
  // ...
});
```

### 7.3 Uniswap Swap (Different Protocol, Same SDK)

```typescript
const envelope = UniswapV3.swapExactIn({
  xrplAddress:     xrplWallet.address,
  routerAddress:   UNISWAP_ROUTER,
  tokenIn:         USDC_ADDRESS,
  tokenOut:        NATIVE_TOKEN,
  fee:             3000,
  amountIn:        parseUnits("100", 6),  // 100 USDC
  minAmountOut:    parseEther("30"),       // min 30 XRP
  destinationXrpl: xrplWallet.address,
  nonce:           currentNonce,
});

// Same signing and submission flow — no adapter changes needed
const signedIntent = await sessionKey.sign(envelope);
await AxelarSubmitter.submit({ signedIntent, bridgeMode: "ITS", ... });
```

---

## 8. Deployment Configuration

### 8.1 Contract Deployment Order

```
1. Deploy XRPLUserProxyFactory(owner, ZERO)          # temporary zero controller
2. Deploy XRPLBridgeAdapterV1 (implementation only)  # no constructor args (UUPS)
3. Deploy ERC1967Proxy(adapterV1, initCalldata)       # UUPS proxy — this is the real adapter address
4. Call factory.setController(proxyAddress)           # point factory to UUPS proxy
5. Call adapter.setIntentSigner(xrplAccount, sessionKey)
6. Call adapter.setAllowedTarget(compoundCToken, true)
7. Call adapter.setAllowedTarget(comptroller, true)
8. Call adapter.setTrustedGmpSource(...)
9. Call adapter.setTrustedItsSource(...)
10. Fund adapter with native XRP for egress gas
```

### 8.2 Upgrade Path (Bug Fix)

```
1. Deploy XRPLBridgeAdapterV2 (new implementation)
2. Call proxy.upgradeTo(adapterV2Address)            # from owner wallet
   # Proxy address unchanged → factory unchanged → user proxy addresses unchanged
   # All user positions intact
```

---

## 9. Known Limitations and Future Work

| Item | Priority | Notes |
|------|----------|-------|
| Multi-call batching | P1 | Allow multiple calldata steps in one cross-chain message (e.g., approve + supply in one intent) |
| ERC-20 tokenIn approval | P1 | Proxy must approve `target` to spend `tokenIn` before calling; add `approveTarget` flag to envelope |
| Gas estimation API | P1 | SDK should provide `estimateGas(intent)` to compute `egressGasValue` dynamically |
| Session key expiry | P1 | Add `sessionKeyExpiry` to intent signer registration so keys auto-expire |
| Multi-step intents | P2 | Allow `callData` to be an array of (target, calldata) pairs executed sequentially |
| Non-EVM execution | P2 | Abstract the execution layer to support non-EVM chains connected via Axelar |
| ZK proof of intent | P2 | Replace ECDSA session key with ZK proof of XRPL master key ownership |
| MEV protection | P2 | Add commit-reveal scheme for sensitive intents (large swaps) |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| Intent | A signed, cross-chain instruction from an XRPL user to execute calldata on an EVM |
| Session key | An ephemeral EVM keypair that signs intents on behalf of the XRPL user |
| Proxy | A per-user EVM smart contract wallet (CREATE2 deterministic) that executes calls to target protocols |
| GMP path | Axelar General Message Passing — no token transfer, carries only calldata |
| ITS path | Axelar Interchain Token Service — transfers tokens + calldata in one message |
| Egress | The return bridge of tokens from XRPL EVM back to the user's XRPL address |
| UUPS | Universal Upgradeable Proxy Standard — allows replacing adapter logic without changing its address |
| Sentinel value | A special `amount` value (`0` or `type(uint256).max`) that signals "use all" to the adapter |
| Target allowlist | A whitelist of EVM contracts the adapter is permitted to call through user proxies |
| xrplAccount | `keccak256(xrplAddress as UTF-8)` — the 32-byte identifier used on-chain for each XRPL user |
