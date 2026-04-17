# Securd User Flows

## 1. Flow notation

Each flow is described in five layers:
- user action on XRPL Ledger
- source-side bridge action
- Axelar transport action
- XRPL EVM adapter action
- lending-core action

## 2. Supply flow

### 2.1 User objective

The user wants to deposit an asset originating on XRPL Ledger so it becomes collateral in Securd on XRPL EVM.

### 2.2 XRPL Ledger side

The user submits a token-bearing XRPL-side bridge action.

The XRPL-side transaction must include enough information to build the `SignedIntent`:
- action = `SUPPLY`
- market
- underlying asset
- amount
- xrpl account id
- nonce
- deadline
- version
- intent id

Because `SUPPLY` transfers value into the protocol, the XRPL-side action must also move the underlying asset toward the Axelar ITS ingress route.

### 2.3 Source integration side

The source integration service:
- parses the XRPL transaction
- verifies the wallet intent format
- builds `SignedIntent`
- submits the token transfer through Axelar ITS
- includes the signed intent in the ITS callback payload

### 2.4 XRPL EVM adapter side

When ITS calls `executeWithInterchainToken(...)`, the adapter performs the following sequence.

1. Verify the caller is the configured ITS contract.
2. Verify the source chain and source address are trusted.
3. Decode `SignedIntent`.
4. Validate base envelope fields.
5. Validate the per-user signature.
6. Verify the action type is `SUPPLY`.
7. Load the configured market.
8. Verify token address, token id, and amount all match the market config and signed intent.
9. Lock `intentId` against replay.
10. Verify the account nonce.
11. Resolve or deploy the user proxy.
12. Transfer the underlying token from the adapter to the user proxy.
13. Ask the proxy to approve the market.
14. Ask the proxy to call `mint(amount)` on the market.
15. Decode the return value and enforce success.
16. Consume the nonce.
17. Emit `IntentExecuted`.

### 2.5 Lending-core side

Inside the market:
- the market accrues interest
- the market asks the Comptroller whether mint is allowed
- underlying is accepted into the market
- cTokens are minted to the user proxy

### 2.6 Final state

After supply:
- underlying principal is held by the market on XRPL EVM
- cTokens are held by the user proxy on XRPL EVM
- nothing is returned to XRPL Ledger

This is intentional. The cTokens are internal lending receipts and remain on XRPL EVM.

## 3. Repay flow

### 3.1 User objective

The user wants to reduce or close a borrow position from XRPL Ledger.

### 3.2 XRPL Ledger side

The user submits a token-bearing XRPL-side bridge action with:
- action = `REPAY`
- market
- underlying asset
- amount
- xrpl account id
- nonce
- deadline
- version
- intent id

The XRPL-side action moves tokens toward the Axelar ITS route.

### 3.3 Source integration side

The source integration service:
- parses the transaction
- builds and signs the intent package
- routes the underlying through ITS

### 3.4 XRPL EVM adapter side

When ITS calls the adapter:
- the adapter repeats the same validation sequence as in supply
- the adapter routes to `_repay(...)` instead of `_supply(...)`
- the proxy approves the market
- the proxy calls `repayBorrow(amount)`
- the adapter validates success and consumes the nonce

### 3.5 Lending-core side

Inside the market:
- interest is accrued
- the repayment amount is applied against the proxy’s borrow balance
- remaining debt is reduced
- if the debt reaches zero, the proxy no longer owes that market

### 3.6 Final state

After repay:
- debt is reduced on XRPL EVM
- no egress back to XRPL Ledger occurs

## 4. Borrow flow

### 4.1 User objective

The user wants to borrow from a collateralized position that already exists on XRPL EVM, but receive the borrowed asset on XRPL Ledger.

### 4.2 XRPL Ledger side

The user submits a control instruction rather than a token-bearing supply.

The XRPL-side instruction must still carry enough data to form the signed intent:
- action = `BORROW`
- market
- underlying asset
- amount
- xrpl account id
- nonce
- deadline
- version
- intent id
- destination address on XRPL Ledger for the returned asset

### 4.3 Source integration side

The source integration service:
- parses the XRPL action
- packages the signed intent
- routes it through Axelar GMP because no inbound tokens are being sent to XRPL EVM

### 4.4 XRPL EVM adapter side

When Gateway calls `execute(...)`, the adapter performs the following sequence.

1. Verify the caller is the configured Gateway.
2. Verify `validateContractCall(...)` succeeds.
3. Verify the source chain and source address are trusted.
4. Decode `SignedIntent`.
5. Validate base envelope fields.
6. Validate the per-user signature.
7. Verify the action type is `BORROW`.
8. Lock `intentId` against replay.
9. Verify the account nonce.
10. Resolve or deploy the user proxy.
11. Ask the proxy to call `borrow(amount)` on the market.
12. Validate the market return code.
13. Pull the borrowed ERC20 from the proxy back into the adapter.
14. Approve ITS for the amount.
15. Call `interchainTransfer(...)` to send the borrowed asset back to the XRPL Ledger destination.
16. Consume the nonce.
17. Emit `IntentExecuted` and `EgressInitiated`.

### 4.5 Lending-core side

Inside the market:
- interest is accrued
- the Comptroller checks available liquidity for the proxy
- collateral value and existing debt are evaluated
- if allowed, the market increases the proxy borrow balance
- underlying is transferred from the market to the proxy

### 4.6 Final state

After borrow:
- debt exists on XRPL EVM in the user proxy
- the borrowed asset is transferred back to XRPL Ledger through ITS

## 5. Withdraw flow

### 5.1 User objective

The user wants to redeem supplied collateral from XRPL EVM and receive the underlying back on XRPL Ledger.

### 5.2 XRPL Ledger side

The user submits a control instruction containing:
- action = `WITHDRAW`
- market
- underlying asset
- amount
- xrpl account id
- nonce
- deadline
- version
- intent id
- destination address on XRPL Ledger for the redeemed asset

### 5.3 Source integration side

The source integration service sends the signed control intent through GMP.

### 5.4 XRPL EVM adapter side

The adapter sequence is similar to borrow.

1. Validate Gateway call and trusted source.
2. Decode and verify the signed intent.
3. Enforce replay and nonce rules.
4. Resolve the user proxy.
5. Ask the proxy to call `redeemUnderlying(amount)` on the market.
6. Validate the market return code.
7. Pull the redeemed underlying from the proxy.
8. Call ITS `interchainTransfer(...)` to send the asset back to XRPL Ledger.
9. Consume the nonce.
10. Emit execution and egress events.

### 5.5 Lending-core side

Inside the market:
- interest is accrued
- the Comptroller checks whether the redemption leaves enough collateral
- if allowed, cTokens are burned from the proxy
- underlying is transferred to the proxy

### 5.6 Final state

After withdraw:
- the proxy holds fewer cTokens
- the underlying has been sent back to XRPL Ledger through ITS

## 6. What happens with liquidations

The current XRPL-Axelar adapter does not implement a dedicated XRPL-origin liquidation entry path.

Liquidation still exists in the lending core on XRPL EVM through the standard market contracts.

This means:
- the protocol remains liquidatable on XRPL EVM
- liquidation bots or operators may interact directly on XRPL EVM
- cross-chain liquidation automation can be added later without changing the core lending state model

## 7. Failure semantics by user action

### 7.1 Supply and repay

Possible failure points:
- wrong ITS source
- wrong market, token, or token id configuration
- invalid signature
- stale deadline
- nonce mismatch
- market call returns non-zero

Effect:
- destination execution reverts
- no supply or repay is recorded

### 7.2 Borrow and withdraw

Possible failure points:
- wrong GMP source
- invalid signature
- insufficient collateral or liquidity
- market call returns non-zero
- egress transfer initiation failure

Effect:
- destination execution reverts
- no borrow or withdraw state remains committed in that transaction

## 8. Why the proxy model matters in every flow

The proxy is the protocol user on XRPL EVM.

This means:
- the market sees one normal EVM account
- the Comptroller performs its checks against one normal EVM account
- collateral and debt accounting work without special cross-chain hooks inside the core
- the bridge layer stays outside the lending engine rather than rewriting it
