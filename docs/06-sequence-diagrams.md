# Securd Sequence Diagrams

## 1. Purpose

This document adds sequence diagrams for the main user paths so engineers, auditors, and operators can quickly understand the runtime interactions.

## 2. Supply sequence

```mermaid
sequenceDiagram
    participant U as User on XRPL Ledger
    participant X as XRPL Source Integration
    participant ITS as Axelar ITS
    participant A as XRPLSecurdBridgeAdapter
    participant F as XRPLUserProxyFactory
    participant P as XRPLUserProxy
    participant M as CErc20 Market
    participant C as Comptroller

    U->>X: Submit Payment + supply intent metadata
    X->>ITS: Send token + SignedIntent
    ITS->>A: executeWithInterchainToken(...)
    A->>A: Verify ITS caller and trusted source
    A->>A: Decode SignedIntent and verify signature
    A->>A: Check market, tokenId, amount, nonce, replay
    A->>F: getOrCreateProxy(xrplAccount)
    F-->>A: proxy address
    A->>P: transfer underlying to proxy
    A->>P: approve market
    A->>P: execute(market, mint(amount))
    P->>M: mint(amount)
    M->>C: mintAllowed / policy checks
    C-->>M: allowed
    M-->>P: mint success and cTokens
    P-->>A: call result
    A->>A: consume nonce and emit IntentExecuted
```

## 3. Repay sequence

```mermaid
sequenceDiagram
    participant U as User on XRPL Ledger
    participant X as XRPL Source Integration
    participant ITS as Axelar ITS
    participant A as XRPLSecurdBridgeAdapter
    participant F as XRPLUserProxyFactory
    participant P as XRPLUserProxy
    participant M as CErc20 Market
    participant C as Comptroller

    U->>X: Submit Payment + repay intent metadata
    X->>ITS: Send token + SignedIntent
    ITS->>A: executeWithInterchainToken(...)
    A->>A: Verify source, signature, market, token, nonce, replay
    A->>F: getOrCreateProxy(xrplAccount)
    F-->>A: proxy address
    A->>P: transfer underlying to proxy
    A->>P: approve market
    A->>P: execute(market, repayBorrow(amount))
    P->>M: repayBorrow(amount)
    M->>C: repayBorrowAllowed / policy checks
    C-->>M: allowed
    M-->>P: repay success
    P-->>A: call result
    A->>A: consume nonce and emit IntentExecuted
```

## 4. Borrow sequence

```mermaid
sequenceDiagram
    participant U as User on XRPL Ledger
    participant X as XRPL Source Integration
    participant G as Axelar Gateway
    participant A as XRPLSecurdBridgeAdapter
    participant F as XRPLUserProxyFactory
    participant P as XRPLUserProxy
    participant M as CErc20 Market
    participant C as Comptroller
    participant ITS as Axelar ITS
    participant D as XRPL Ledger Destination

    U->>X: Submit Payment or control request + borrow intent metadata
    X->>G: Send GMP SignedIntent
    G->>A: execute(...)
    A->>A: Verify gateway approval and trusted source
    A->>A: Decode SignedIntent and verify signature
    A->>A: Check market, nonce, replay, deadline
    A->>F: getOrCreateProxy(xrplAccount)
    F-->>A: proxy address
    A->>P: execute(market, borrow(amount))
    P->>M: borrow(amount)
    M->>C: borrowAllowed / liquidity checks
    C-->>M: allowed
    M-->>P: underlying transferred to proxy
    P-->>A: call result
    A->>P: pull borrowed underlying
    A->>ITS: interchainTransfer(tokenId, destinationChain, destinationAddress, amount)
    ITS->>D: deliver borrowed asset
    A->>A: consume nonce and emit IntentExecuted + EgressInitiated
```

## 5. Withdraw sequence

```mermaid
sequenceDiagram
    participant U as User on XRPL Ledger
    participant X as XRPL Source Integration
    participant G as Axelar Gateway
    participant A as XRPLSecurdBridgeAdapter
    participant F as XRPLUserProxyFactory
    participant P as XRPLUserProxy
    participant M as CErc20 Market
    participant C as Comptroller
    participant ITS as Axelar ITS
    participant D as XRPL Ledger Destination

    U->>X: Submit Payment or control request + withdraw intent metadata
    X->>G: Send GMP SignedIntent
    G->>A: execute(...)
    A->>A: Verify gateway approval and trusted source
    A->>A: Decode SignedIntent and verify signature
    A->>A: Check market, nonce, replay, deadline
    A->>F: getOrCreateProxy(xrplAccount)
    F-->>A: proxy address
    A->>P: execute(market, redeemUnderlying(amount))
    P->>M: redeemUnderlying(amount)
    M->>C: redeemAllowed / liquidity checks
    C-->>M: allowed
    M-->>P: underlying transferred to proxy
    P-->>A: call result
    A->>P: pull redeemed underlying
    A->>ITS: interchainTransfer(tokenId, destinationChain, destinationAddress, amount)
    ITS->>D: deliver redeemed asset
    A->>A: consume nonce and emit IntentExecuted + EgressInitiated
```

## 6. Oracle fallback update sequence

```mermaid
sequenceDiagram
    participant B as Oracle Bot
    participant O as SecurdPriceOracle
    participant C as Comptroller
    participant M as CErc20 Market

    B->>O: postFallbackPrice(asset, priceMantissa)
    O->>O: Verify bot is authorized for asset
    O->>O: Store price and updatedAt
    M->>C: borrow/redeem/liquidation check
    C->>O: getUnderlyingPrice(cToken)
    O-->>C: fallback price if fresh
```

## 7. Notes

- `SUPPLY` and `REPAY` are value-bearing ingress actions.
- `BORROW` and `WITHDRAW` are control ingress actions with token egress.
- The bridge adapter is the only contract allowed to orchestrate the user proxy.
- cTokens stay on XRPL EVM and are not returned to XRPL Ledger.
