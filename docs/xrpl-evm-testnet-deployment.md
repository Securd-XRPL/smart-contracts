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
| XRPL EVM user proxy (deterministic via CREATE2) | `0x02b79e2c6D91B384ddD1767F8C4321D2ACBBEFE8` |

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
| Unitroller (Comptroller proxy) | `0x26Cf3D5c8832D77eadF0a76d36E33a92200EE883` |
| Comptroller implementation | `0x8B18A48e6B833d08a512E468107d1f56154bbd49` |
| CollateralFactorTimelock | `0xAFD847d1eE5E5c8967eA16823CbA19f7bA19B099` |
| Oracle | `0x3e4B7874A46815F49eBebE598213ecEda260ca04` |
| Interest Rate Model | `0x64ccEa09e73171EE78eb382EE89fc72150e812ab` |
| cErc20Delegate (implementation) | `0x1b9afD0C2CFaD9B167CC7B2f5B643D46becB76AD` |
| Liquidation Keeper | `0x870A7fCF5591a20Ff64868bF9aBa740d0318FdCD` |
| XRPLUserProxyFactory | `0x04a8A4b4C26a81764Bcc7610072aA8A22e165559` |
| XRPLSecurdBridgeAdapter | `0xf1CBD0f07580ff9A0961cB97758363f42D95df20` |

### sXRP Market

| Parameter | Value |
|-----------|-------|
| cToken symbol | `sXRP` |
| cToken name | Securd XRP |
| cToken address | `0xcD881baC550Ae161942c93CF393822E97c745811` |
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
| Adapter native XRP balance (funded) | 10 XRP (2 XRP consumed by WITHDRAW + BORROW egress → 8 XRP remaining) |

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

End-to-end testnet transaction log: [docs/xrpl-lending-testnet-transactions-v2.md](xrpl-lending-testnet-transactions-v2.md)
