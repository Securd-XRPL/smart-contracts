# Securd Security Model

## 1. Security goals

Securd is designed to protect four things:
- user collateral on XRPL EVM
- correctness of lending state transitions
- correctness of cross-chain routing
- correctness of asset pricing

## 2. Trust boundaries

### 2.1 Trusted components

The protocol trusts:
- the deployed Axelar Gateway contract configured in the adapter
- the deployed Axelar Interchain Token Service configured in the adapter
- the owner-configured trusted source applications for GMP and ITS
- the owner-configured intent signer per XRPL account
- the owner and asset-specific oracle bot roles
- the core lending contracts and their admin controls

### 2.2 Not trusted by default

The protocol does not trust:
- arbitrary Axelar sources
- arbitrary payloads
- arbitrary tokens delivered through ITS
- arbitrary market addresses
- stale oracle updates
- repeated intent execution

## 3. Ingress authorization

The adapter applies authorization in layers.

### 3.1 Axelar contract verification

`execute(...)` only accepts calls from the configured Gateway.

`executeWithInterchainToken(...)` only accepts calls from the configured ITS contract.

### 3.2 Source application allowlist

Even if the call arrives from the correct Axelar contract, the source chain and source application must still be allowlisted.

This blocks unrelated Axelar messages from interacting with the adapter.

### 3.3 Per-user intent signature

The destination adapter verifies a user-specific signer configured through `setIntentSigner(...)`.

Properties:
- signature domain includes the adapter address
- signature domain includes `block.chainid`
- signature is over the canonical hash of the `IntentEnvelope`

Why it matters:
- Axelar source validation alone is not enough
- the adapter also requires per-user approval at the application layer

## 4. Replay protection and ordering

### 4.1 Replay protection

Each intent is keyed by `intentId`.

The adapter stores:
- `payloadHashByIntent[intentId]`

Rules:
- unseen id + valid payload => execute and lock
- same id + same payload => duplicate no-op
- same id + different payload => revert with `IntentHashConflict`

### 4.2 Nonce sequencing

Each `xrplAccount` has its own `nextNonceByXrplAccount`.

Rules:
- nonce must match the next expected value exactly
- nonce is consumed only after successful execution

This prevents out-of-order action processing for the same account.

## 5. Market and asset validation

The adapter does not execute arbitrary addresses.

The owner must configure each market in `marketConfigOf` with:
- market address
- underlying address
- Axelar token id
- listed flag

Validation rules:
- the market must be listed
- the intent underlying must match the configured underlying
- ITS-delivered token address must match the configured underlying
- ITS-delivered token id must match the configured token id
- ITS-delivered amount must match the signed intent amount

## 6. Proxy isolation

Every user has an isolated proxy account.

Security benefits:
- one user cannot directly contaminate another user position
- cTokens and debts stay scoped to one proxy
- the bridge adapter does not pool user collateral
- token egress pulls only from the intended user proxy

## 7. Pause and admin controls

The adapter inherits `Ownable` and `Pausable`.

Emergency actions:
- pause inbound execution
- unpause after remediation
- reconfigure trusted sources
- reconfigure destination chain and egress gas
- rotate intent signers before a proxy exists for a given account

The factory also freezes controller rotation after the first proxy is deployed, which prevents accidental proxy orphaning.

## 8. Oracle security

The oracle supports three modes per asset.

### 8.1 Chainlink mode

Risks addressed:
- stale feed values
- missing feed configuration

Controls:
- heartbeat is required
- stale feed returns zero instead of a stale price

### 8.2 Band mode

Risks addressed:
- stale reference data
- incomplete symbol configuration

Controls:
- base and quote symbol must be configured
- max delay is enforced
- stale data returns zero

### 8.3 Fallback mode

Used for assets such as XRPL Ledger LP tokens.

Risks addressed:
- no reliable onchain feed exists
- price must be set by a managed bot

Controls:
- asset-specific bot authorization
- owner override path
- staleness window
- per-asset price storage

Operational requirement:
- fallback-priced collateral is only as safe as the bot’s update discipline and monitoring

## 9. Egress safety

For `BORROW` and `WITHDRAW`, the final step is ITS token transfer back to XRPL Ledger.

Important property:
- if egress initiation fails, the whole destination transaction reverts

This means:
- the protocol does not leave a successful borrow or withdraw stranded inside the user proxy while pretending the XRPL transfer succeeded

## 10. Known operational assumptions

These are assumptions, not guarantees provided entirely by Solidity.

### 10.1 XRPL-side source correctness

The repository does not contain the XRPL-side bridge application. Therefore:
- XRPL Payment parsing
- memo decoding
- source-side relaying
- source-side Axelar submission

must be implemented and monitored correctly outside this Solidity repository.

### 10.2 Intent signer lifecycle

The team must manage the signer mapping per XRPL account correctly.

If the wrong signer is configured:
- valid user actions will fail
- or, worse, the wrong signer could authorize actions for the account

### 10.3 Oracle bot lifecycle

For fallback-priced assets, especially XRPL Ledger LP tokens, the oracle bot must:
- publish fresh prices on time
- be monitored for liveness
- be limited to approved assets only

## 11. Recommended operational monitoring

Track at minimum:
- Axelar callback success and failure counts
- failed signature validations
- failed nonce validations
- duplicate intent rate
- egress initiation failures
- paused state changes
- stale fallback prices
- stale Chainlink or Band prices returning zero
- large borrow and withdraw volumes by market

## 12. Residual risks

Residual risks that remain even after the current controls:
- source-side XRPL integration bugs outside this repository
- signer misconfiguration
- oracle bot mispricing or liveness failure for fallback assets
- admin key compromise
- market-specific economic risk from collateral factor or oracle misconfiguration
