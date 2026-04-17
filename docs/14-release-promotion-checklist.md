# Securd Release Promotion Checklist

This checklist is for promoting a deployment from XRPL EVM testnet to XRPL EVM mainnet.

## 1. Testnet readiness

- testnet deployment record stored under `deployments/`
- `npm run validate:deployment-record` passes for the testnet record
- smoke check passes on the deployed testnet stack
- full post-deploy verification passes on the deployed testnet stack
- Unitroller admin acceptance completed on testnet
- keeper deployment completed on testnet
- oracle sources configured on testnet
- fallback LP pricing bot exercised on testnet
- XRPL source integration exercised end-to-end on testnet
- supply / repay / borrow / withdraw happy paths exercised
- liquidation path exercised

## 2. Release approval

- final mainnet owner / multisig confirmed
- final pending Unitroller admin confirmed
- Axelar deployed contract addresses confirmed for XRPL EVM mainnet
- mainnet market list approved
- collateral factors approved
- borrow caps approved
- oracle source selection approved per market
- fallback oracle operators approved
- keeper operators approved
- monitoring and alerting owners confirmed

## 3. Mainnet deployment preparation

- mainnet `.env` prepared from [.env.deploy.example](../.env.deploy.example)
- mainnet market config prepared from [securd-markets.example.json](../config/securd-markets.example.json)
- trusted GMP sources confirmed
- trusted ITS sources confirmed
- deployment output path prepared under `deployments/`
- deployment record signing key available if signed manifests are used

## 4. Mainnet deployment execution

- `npm run typecheck`
- `npm run validate:deploy-inputs`
- `npm run deploy:full-stack`
- `npm run validate:deployment-record`
- `npm run accept:unitroller-admin` from pending admin wallet
- `npm run smoke:deployment`
- `npm run verify:deployment`
- `npm run deploy:keeper`

## 5. Mainnet post-deploy controls

- keeper treasury funded
- keeper executors authorized
- bot config validated
- liquidation bot connected to mainnet RPC
- fallback oracle bot connected to mainnet RPC
- deployment record signed
- signed manifest verified
- runbook outputs stored internally

## 6. Go-live decision

- technical lead signoff
- security signoff
- ops signoff
- incident rollback plan confirmed
- public launch timing approved
