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
| XRPL EVM user proxy (deterministic via CREATE2) | `0x4F654Fb71f7176fB98A8DB3A9b974201195028ec` |

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
| Unitroller (Comptroller proxy) | `0xbD758A39e6e0C601c35655394eCbb88443Ba37A6` |
| Comptroller implementation | `0x19b770AaF7F27a3B773e43b4aF61f996C4B6604a` |
| CollateralFactorTimelock | `0x6AD5107E1bA2439B75fCE222Bd91D214Be34E2ca` |
| Oracle | `0xC16213F10911767a1011fC42EA253d93130079b4` |
| Interest Rate Model | `0x2127469237fDE5C730191F2B7B2eB4fa3355aA5C` |
| cErc20Delegate (implementation) | `0x1B59B2F946D0061937305633621BDfF18d9aB98a` |
| Liquidation Keeper | `0xe3db6Ada7e4b4d072EA00482d19FC10f75213558` |
| XRPLUserProxyFactory | `0x832774Fa7E8E3B3dcd57208cE6C6bD4648aeF2c7` |
| XRPLSecurdBridgeAdapter | `0xb457321CF05bC4ACe87d15B5400A5dD944bC444f` |

### sXRP Market

| Parameter | Value |
|-----------|-------|
| cToken symbol | `sXRP` |
| cToken name | Securd XRP |
| cToken address | `0xdC23077B9E2d02Dee0f1F4784D2526e4A20f3869` |
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
