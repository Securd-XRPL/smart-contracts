# XRPL EVM Testnet — Deployment Reference

All addresses, keys, and setup parameters for the Securd lending stack on XRPL EVM testnet.
**Never commit the actual `.env` file.** This document is for reference only; secrets stay local.

---

## Network

| Parameter | Value |
|-----------|-------|
| Network name | XRPL EVM Sidechain Testnet |
| Chain ID | `1449000` |
| RPC URL | `https://rpc.testnet.xrplevm.org` |
| Explorer | https://explorer.testnet.xrplevm.org |
| Axelar chain name | `xrpl-evm` |

---

## Wallets

| Role | Address |
|------|---------|
| Deployer / owner / intent signer | `0x243CD17C18052dD49B803dB5be3c2907DA6ff783` |
| XRPL Ledger wallet | `r4obbPExFxVcmqUBr5jepsdtDLX3htdq48` |
| XRPL EVM user proxy (deterministic via CREATE2) | `0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86` |

Private keys live only in `.env` (gitignored).

---

## Axelar Infrastructure (pre-deployed by Axelar)

| Contract | Address |
|----------|---------|
| Axelar Gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Interchain Token Service (ITS) | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| XRPL Ledger Axelar Gateway | `rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2` |

---

## Securd Lending Stack (deployed)

| Contract | Address |
|----------|---------|
| Unitroller (Comptroller proxy) | `0x46d364257112230022E72b086Df85a6b0f8D3F86` |
| Comptroller implementation | `0x19b8936999af4858357Cfe9CCA80B72711ad2714` |
| CollateralFactorTimelock | `0xe752dfF3f9F3Dbfa48764B076543270F19a75E90` |
| Oracle | `0x517475AFaFfaE71491d9Bad598E07AAFD050Ca80` |
| Interest Rate Model | `0xDd31C1db90AB0b094d73E0b4c8dae2296a7d8C0d` |
| cErc20Delegate (implementation) | `0xC803D3D50465a8deC7F0A21034900efcE650a7b8` |
| Liquidation Keeper | `0xF87Bda7207B629789abaaCcef366Ba853BA11399` |
| XRPLUserProxyFactory | `0xB7f3ECe856063F48BC3bcC7A381aE875841663aA` |
| XRPLSecurdBridgeAdapter | `0x7AC8Df85448037c6fE1eD5732c6ca71060069237` |

### sXRP Market

| Parameter | Value |
|-----------|-------|
| cToken symbol | `sXRP` |
| cToken name | Securd XRP |
| cToken address | `0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318` |
| Underlying | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (native XRP) |
| Collateral factor | 75% (`750000000000000000`) |
| Oracle mode | FALLBACK |
| Fallback price | 2.5 USD (`2500000000000000000`) |
| Fallback max delay | 86400 seconds (24 h) |
| ITS bridge token ID | `0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f` |

---

## Adapter Setup Parameters

| Parameter | Value |
|-----------|-------|
| Egress gas value | `1000000000000000000` (1 XRP in wei) |
| Intent signer for XRPL wallet | `0x243CD17C18052dD49B803dB5be3c2907DA6ff783` |
| Adapter native XRP balance (funded) | 5 XRP (2 XRP consumed by WITHDRAW + BORROW egress → 3 XRP remaining) |

---

## Trusted Source Configuration

### Trusted GMP Sources (`config/trusted-gmp-sources-testnet.json`)

```json
[{ "chain": "xrpl", "address": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48" }]
```

### Trusted ITS Sources (`config/trusted-its-sources-testnet.json`)

```json
[{ "chain": "xrpl", "address": "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48", "encoding": "utf8" }]
```

---

## Deployment & Setup Commands

```bash
# 1. Deploy all contracts
set -a && source .env && set +a
npx hardhat run scripts/deploySecurdXrpl.ts --network xrplEvm

# 2. Setup adapter (intent signer, oracle config, fallback price)
npx ts-node scripts/setupAdapter.ts

# 3. Fund adapter with native XRP for egress gas
npx ts-node scripts/fundAdapter.ts

# 4. Check state (nonce, proxy, balances)
npx ts-node scripts/checkState.ts
```

---

## Action Scripts

| Action | Script | Axelar mechanism | Key env vars |
|--------|--------|-----------------|--------------|
| SUPPLY | `scripts/submitXrplDeposit.ts` | ITS `interchain_transfer` | `XRPL_DEPOSIT_AMOUNT_DROPS`, `XRPL_DEPOSIT_GAS_FEE_DROPS` |
| WITHDRAW | `scripts/submitXrplWithdraw.ts` | GMP `call_contract` | `XRPL_WITHDRAW_AMOUNT_XRP`, `XRPL_GMP_GAS_DROPS` |
| BORROW | `scripts/submitXrplBorrow.ts` | GMP `call_contract` | `XRPL_BORROW_AMOUNT_XRP`, `XRPL_GMP_GAS_DROPS` |
| REPAY | `scripts/submitXrplRepay.ts` | ITS `interchain_transfer` | `XRPL_REPAY_AMOUNT_DROPS`, `XRPL_REPAY_GAS_FEE_DROPS` |

All scripts require `XRPL_CONFIRM_SEND=true` to submit on-chain (default is dry-run).

---

## GMP Relay Notes

- **SUPPLY / REPAY** use ITS `interchain_transfer` — tokens travel inbound with the message.
- **WITHDRAW / BORROW** use GMP `call_contract` — only gas travels inbound; tokens are sent back via ITS egress.
- Axelar relayer calls `execute()` from its own EOA (not the gateway contract). Never add `msg.sender == gateway` in `execute()`.
- `gateway.validateContractCall()` is the only gateway security check needed.
- Egress requires the adapter to hold native XRP. Top up via `fundAdapter.ts` when balance is low.

---

## Deployment Manifest

Full JSON deployment record: [deployments/xrpl-evm-testnet.json](../deployments/xrpl-evm-testnet.json)

End-to-end testnet transaction log (v4 redeployment): [docs/xrpl-lending-testnet-transactions-v2.md](xrpl-lending-testnet-transactions-v2.md)
