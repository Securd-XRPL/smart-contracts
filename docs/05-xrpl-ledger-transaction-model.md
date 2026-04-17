# XRPL Ledger Transaction Model

## 1. Scope

This document explains how an XRPL Ledger user action should be represented before it reaches the XRPL EVM contracts.

Important boundary:
- this repository contains the XRPL EVM destination contracts
- it does not contain the XRPL Ledger source-side bridge contract or relayer implementation

For that reason, this document specifies the required transaction model and payload content, and clearly separates:
- what must exist on XRPL Ledger
- what is actually enforced by the Solidity contracts in this repository

## 2. Why XRPL uses a Payment-centric entry model

On XRPL Ledger, the most natural user-origin transaction primitive is `Payment`.

Securd uses that fact in two ways.

### 2.1 Token-bearing actions

For `SUPPLY` and `REPAY`, the user must actually move value.

A `Payment` transaction is the correct user action because it can:
- transfer the asset amount
- identify the bridge receiver account on XRPL Ledger
- carry memos used by the source-side integration

### 2.2 Control-only actions

For `BORROW` and `WITHDRAW`, the user is not sending principal into XRPL EVM.

Even here, the XRPL-side integration may still choose a `Payment`-based trigger because:
- it is a native XRPL transaction type users already sign
- it can carry memos that encode the action request
- it provides a canonical transaction hash for offchain tracing

In practice, the source-side integration may use:
- a zero-value or minimal-value `Payment`, if supported by the integration pattern
- a small operational payment to the source bridge service account
- or another XRPL-side instruction pattern that the bridge stack supports

The exact source-side transport account and memo schema are integration-specific and are not enforced by the Solidity contracts here.

## 3. Required semantic fields

No matter how the source-side integration is implemented, it must recover these semantic fields from the XRPL Ledger user request.

Required fields:
- `intentId`
- `xrplAccount`
- `market`
- `underlying`
- `actionType`
- `amount`
- `nonce`
- `deadline`
- `destinationAddress`
- `version`
- `signature`

These become the `SignedIntent` consumed by the XRPL EVM bridge adapter.

## 4. Recommended XRPL Payment shape

For a user wallet or frontend, the recommended XRPL-side transaction model is:

### 4.1 Common fields

- `TransactionType = Payment`
- `Account = user XRPL address`
- `Destination = source bridge account or Axelar-facing ingress account`
- `Amount = transferred amount for token-bearing actions, or integration-defined minimal amount for control actions`
- `Memos = structured action metadata`

### 4.2 Memo payload contents

Recommended memo content:
- protocol tag: `SECURD`
- action: `SUPPLY`, `REPAY`, `BORROW`, or `WITHDRAW`
- intent id
- normalized XRPL account id or derivation reference
- target XRPL EVM market address
- target XRPL EVM underlying address
- amount
- nonce
- deadline
- destination bytes for egress
- version
- optional frontend request id for tracing

The source integration service should convert those memos into the exact ABI-encoded `SignedIntent` expected by the adapter.

## 5. Token-bearing Payment for supply

A recommended `SUPPLY` transaction on XRPL Ledger looks like this conceptually.

1. User selects asset and amount.
2. Frontend resolves the corresponding XRPL EVM market and underlying configuration.
3. Frontend chooses the next nonce for the user.
4. Frontend produces the canonical intent hash.
5. User signs the intent through the configured signing flow.
6. User submits a `Payment` that transfers the asset amount to the source bridge route.
7. Memos carry the action metadata.
8. Source integration forwards the asset and intent through Axelar ITS.

What the XRPL EVM adapter later enforces:
- action is `SUPPLY`
- token id matches the configured market token id
- delivered token address matches the configured underlying
- delivered amount matches the signed amount

## 6. Token-bearing Payment for repay

A recommended `REPAY` transaction follows the same structure as supply.

Differences:
- action is `REPAY`
- the amount is intended to reduce debt rather than mint collateral

The source integration still forwards the asset through ITS.

## 7. Payment-based control request for borrow

A recommended `BORROW` request on XRPL Ledger is a `Payment` or equivalent trigger whose primary role is signaling, not funding the destination action.

The user-facing sequence is:

1. User chooses the borrow market, amount, and XRPL destination address.
2. Frontend computes the next nonce.
3. Frontend prepares the `IntentEnvelope`.
4. User signs the intent.
5. User submits the XRPL transaction carrying the action metadata in memos.
6. Source integration reads the request and submits a GMP message through Axelar.

What the XRPL EVM adapter later enforces:
- action is `BORROW`
- signature is valid for the configured signer of the XRPL account
- nonce is exact
- deadline has not passed
- the target market is listed
- egress destination bytes are non-empty

## 8. Payment-based control request for withdraw

A recommended `WITHDRAW` request follows the same model as borrow.

The important semantic difference is that the destination-side market call is `redeemUnderlying(amount)` rather than `borrow(amount)`.

## 9. Recommended source-side processing pipeline

The XRPL source integration should behave like this.

1. Observe finalized XRPL transaction.
2. Verify the destination bridge account and expected memo structure.
3. Normalize the XRPL sender into the protocol `xrplAccount` format.
4. Construct the canonical `IntentEnvelope`.
5. Wrap it into `SignedIntent`.
6. Route based on action type.

Routing:
- `SUPPLY`, `REPAY` -> ITS token path
- `BORROW`, `WITHDRAW` -> GMP control path

## 10. Relationship between XRPL transaction hash and intent id

These are not the same thing.

### 10.1 XRPL transaction hash

Used for:
- wallet receipts
- source-chain tracing
- operational reconciliation

### 10.2 intentId

Used for:
- application-layer idempotency on XRPL EVM
- replay protection in the adapter
- correlating source and destination activity even if the same user submits many transactions

Recommendation:
- keep both
- index both in offchain monitoring and analytics

## 11. Destination address encoding

The adapter expects `destinationAddress` as raw bytes inside the intent.

This is intentional because:
- the XRPL-side destination format is not a Solidity `address`
- different integrations may encode XRPL destination information differently
- the bytes can include whatever the source and ITS route require

Operational recommendation:
- define one canonical encoding rule offchain for XRPL addresses and any destination-tag-related data
- enforce it in frontend, relayer, and monitoring services

## 12. What the XRPL EVM contracts do not know

The XRPL EVM contracts do not know:
- the original XRPL `Payment` amount formatting rules
- XRPL memo encoding conventions
- which XRPL source account acted as the user bridge receiver
- whether a destination tag was used on XRPL Ledger

They only know the normalized result that arrives through Axelar:
- trusted source identity
- token callback or message callback
- ABI-decoded `SignedIntent`
- token id, token address, and amount on the ITS path

## 13. Minimum operational checklist for XRPL transaction support

Before production, the XRPL-side integration should guarantee:
- canonical memo schema
- canonical account normalization
- canonical intent hashing
- exact nonce sourcing
- exact destination-byte encoding
- clear reconciliation between XRPL tx hash, Axelar message id, intent id, and XRPL EVM tx hash

## 14. Practical summary by user function

### SUPPLY
- XRPL user submits token-bearing `Payment`
- source side forwards tokens plus intent via ITS
- XRPL EVM mints market tokens into the user proxy

### REPAY
- XRPL user submits token-bearing `Payment`
- source side forwards tokens plus intent via ITS
- XRPL EVM reduces proxy debt

### BORROW
- XRPL user submits memo-bearing control request, commonly modeled as a `Payment`
- source side forwards intent via GMP
- XRPL EVM borrows into proxy and immediately egresses tokens back to XRPL Ledger

### WITHDRAW
- XRPL user submits memo-bearing control request, commonly modeled as a `Payment`
- source side forwards intent via GMP
- XRPL EVM redeems underlying into proxy and immediately egresses tokens back to XRPL Ledger


## 15. Related pricing note for XRPL LP collateral

The XRPL `Payment` transaction model described here is how users initiate lending actions.

It is separate from the pricing model for XRPL AMM LP tokens used as collateral. That pricing is derived from XRPL `amm_info` state and published by the fallback oracle bot on XRPL EVM.

See [15-xrpl-lp-oracle-bot.md](15-xrpl-lp-oracle-bot.md).
