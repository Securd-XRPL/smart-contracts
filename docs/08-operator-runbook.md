# Securd Operator Runbook

## 1. Purpose

This runbook is for protocol operators responsible for:
- the XRPL-side source integration or relayer
- the fallback oracle bot for LP collateral and other fallback-priced assets
- bridge monitoring and incident response

## 2. Operator roles

### 2.1 XRPL source integration operator

Responsible for:
- observing XRPL user transactions
- parsing memos and transaction context
- constructing canonical `SignedIntent` payloads
- routing `SUPPLY` and `REPAY` through ITS
- routing `BORROW` and `WITHDRAW` through GMP
- correlating XRPL tx hash, Axelar message id, intent id, and XRPL EVM tx hash

### 2.2 Oracle bot operator

Responsible for:
- publishing fresh fallback prices for configured assets
- limiting updates to authorized assets only
- detecting stale-price windows before they break user actions
- maintaining the input methodology for LP collateral pricing

### 2.3 Protocol admin operator

Responsible for:
- trusted source configuration
- pause and unpause decisions
- market listing
- signer management
- emergency remediation

## 3. XRPL source integration runbook

### 3.1 Intake sequence

For every user request:
1. observe finalized XRPL transaction
2. verify the request targets the expected bridge receiver path
3. parse memos
4. normalize the XRPL sender to the protocol `xrplAccount`
5. derive the exact intended market, underlying, amount, nonce, and destination bytes
6. construct the `IntentEnvelope`
7. attach the signature and route via Axelar

### 3.2 Action routing rules

- `SUPPLY` -> ITS
- `REPAY` -> ITS
- `BORROW` -> GMP
- `WITHDRAW` -> GMP

### 3.3 Submission checks before forwarding

Never forward unless all of the following are true:
- market is known and listed in operator config
- underlying asset matches the market config
- token id mapping is known
- nonce is the expected next nonce for the account in the operator’s state model
- destination bytes are present for `BORROW` and `WITHDRAW`
- signature is present and valid in the source integration’s validation flow

### 3.4 Reconciliation fields

Track and persist:
- XRPL transaction hash
- XRPL sender address
- intent id
- action type
- market
- amount
- Axelar message or command id
- XRPL EVM transaction hash
- final result state

## 4. Oracle bot runbook

### 4.1 Assets that should use the bot

Use fallback posting only for assets that do not have a dependable onchain feed, especially:
- XRPL Ledger LP collateral
- bridged assets without acceptable Chainlink or Band coverage

### 4.2 Bot update cycle

For each asset:
1. fetch the external price input from the approved methodology
2. transform it into the 1e18 mantissa expected onchain
3. check whether the result is materially different from the last posted price
4. check whether the asset is still configured in fallback mode
5. call `postFallbackPrice(asset, priceMantissa)` from the authorized bot address
6. confirm the onchain update and store the tx hash

### 4.3 Mandatory bot safeguards

The bot should enforce offchain checks before posting:
- asset allowlist
- min and max sanity bands
- maximum step change threshold unless manually overridden
- freshness watchdog
- duplicate submission suppression
- RPC and signer health checks

### 4.4 LP collateral pricing guidance

For XRPL Ledger LP collateral, the pricing methodology should be explicitly documented outside the contract.

A typical methodology may include:
- reserve balances of the LP pair
- total LP token supply
- external prices of the underlying assets
- haircut or conservative discount before posting onchain

The bot should never infer a price without a deterministic methodology approved by risk governance.

## 5. Monitoring thresholds

Alert immediately on:
- adapter paused state changes
- repeated invalid signature failures
- repeated invalid nonce failures
- repeated token mismatch failures
- egress initiation failures
- fallback-priced asset nearing stale threshold
- fallback-priced asset already stale
- abnormal borrow or withdraw spikes by market

## 6. Incident playbooks

### 6.1 Trusted source compromise suspected

Actions:
1. pause the adapter immediately
2. disable trusted source entries
3. review recent intents and destination transactions
4. rotate source-side infrastructure credentials
5. rotate affected intent signers if needed
6. unpause only after source validation is restored

### 6.2 Fallback oracle bot failure

Actions:
1. identify which fallback assets are affected
2. check whether stale prices have already caused `getUnderlyingPrice` to return zero
3. if affected collateral is critical, pause market-facing operations operationally or pause adapter ingress if needed
4. restore bot service or post manually from owner
5. verify new prices are fresh before resuming normal operations

### 6.3 Egress transfer failures

Actions:
1. inspect available native gas on the adapter
2. verify `egressGasValue` against current route requirements
3. verify ITS token id mapping and destination bytes encoding
4. replay only through a new user intent if the original transaction reverted entirely

### 6.4 Signer misconfiguration

Actions:
1. confirm the intended signer for the XRPL account
2. update with `setIntentSigner(...)`
3. test a canary action before reopening normal usage for the account

## 7. Daily operator checklist

Every day, confirm:
- Axelar routes are healthy
- trusted source config matches the expected source applications
- adapter has enough native gas for egress
- fallback-priced assets are fresh
- no abnormal spikes in rejected intents
- XRPL-side relayer backlog is within threshold

## 8. Weekly risk checklist

Every week, confirm:
- fallback asset list is still justified
- LP pricing methodology remains valid
- collateral factors for fallback-priced assets remain conservative
- source integration logging is complete and queryable
- canary flow tests still succeed end-to-end
