# Securd

Securd is an XRPL-native lending protocol architecture where users initiate actions from XRPL Ledger while lending state, risk checks, collateral accounting, and market execution live on XRPL EVM.

The protocol keeps the lending core on XRPL EVM and adds an Axelar-based cross-chain execution layer around it.

## Core idea

- Users originate actions from XRPL Ledger.
- Execution happens on XRPL EVM.
- `SUPPLY` and `REPAY` enter through Axelar Interchain Token Service with token transfer.
- `BORROW` and `WITHDRAW` enter through Axelar General Message Passing as control messages.
- `BORROW` and `WITHDRAW` complete with token egress back to XRPL Ledger through Axelar Interchain Token Service.
- User positions stay on XRPL EVM inside deterministic per-user proxy accounts.
- XRPL Ledger LP tokens can be accepted as collateral through the fallback oracle path managed by an authorized oracle bot.

## Repository layout

- `contracts/core/`: lending core, markets, proxy admin layer, oracle, and interest models.
- `contracts/xrpl-axelar-integration/`: cross-chain adapter, deterministic user proxies, and intent schema.
- `docs/`: Securd architecture, contracts, security, and user-flow documentation.
- `scripts/`: deployment and operations scripts.
- `test/`: protocol tests.

## Active contract groups

### Lending core

- `Unitroller.sol`: upgradeable proxy shell for the risk engine.
- `Comptroller.sol`: market listing, collateral policy, liquidity checks, borrow limits, liquidation policy, pause controls, and disabled legacy reward accounting.
- `CToken.sol`: shared market accounting logic.
- `CErc20.sol`: ERC20-backed market implementation.
- `CErc20Delegator.sol` and `CErc20Delegate.sol`: delegator/delegate pattern for ERC20-backed markets.
- `JumpRateModelV2.sol` and `BaseJumpRateModelV2.sol`: utilization-based interest-rate model.
- `SecurdPriceOracle.sol`: per-asset price source selection using Chainlink, Band, or an authorized fallback bot.

### XRPL-Axelar integration

- `XRPLSecurdBridgeAdapter.sol`: Axelar ingress validation, signed-intent verification, proxy orchestration, market execution, and token egress.
- `XRPLUserProxyFactory.sol`: deterministic CREATE2 deployment of one proxy per XRPL account.
- `XRPLUserProxy.sol`: isolated execution wallet that owns the user position on XRPL EVM.
- `XRPLSecurdTypes.sol`: action enum and signed intent envelope.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [docs/README.md](docs/README.md)
- [docs/01-system-architecture.md](docs/01-system-architecture.md)
- [docs/02-contract-reference.md](docs/02-contract-reference.md)
- [docs/03-security-model.md](docs/03-security-model.md)
- [docs/04-user-flows.md](docs/04-user-flows.md)
- [docs/05-xrpl-ledger-transaction-model.md](docs/05-xrpl-ledger-transaction-model.md)
- [docs/06-sequence-diagrams.md](docs/06-sequence-diagrams.md)
- [docs/07-deployment-configuration.md](docs/07-deployment-configuration.md)
- [docs/08-operator-runbook.md](docs/08-operator-runbook.md)
- [docs/09-liquidation-strategy.md](docs/09-liquidation-strategy.md)
- [docs/10-liquidation-bot-spec.md](docs/10-liquidation-bot-spec.md)
- [docs/11-treasury-sizing-worksheet.md](docs/11-treasury-sizing-worksheet.md)
- [docs/12-keeper-wrapper-design.md](docs/12-keeper-wrapper-design.md)
- [docs/13-deployment-runbook.md](docs/13-deployment-runbook.md)
- [docs/14-release-promotion-checklist.md](docs/14-release-promotion-checklist.md)
- [docs/15-xrpl-lp-oracle-bot.md](docs/15-xrpl-lp-oracle-bot.md)
- [docs/16-github-actions-setup.md](docs/16-github-actions-setup.md)
  Real-time XRPL AMM LP-token valuation, fallback oracle publication, and decentralization roadmap for LP pricing.

Relevant tooling:

- LP oracle config validator: [validateXrplLpOracleConfig.ts](scripts/validateXrplLpOracleConfig.ts)
- LP oracle bot scaffold: [runXrplLpOracleBot.ts](scripts/runXrplLpOracleBot.ts)
- Median reporter contract: [SecurdMedianOracleReporter.sol](contracts/core/SecurdMedianOracleReporter.sol)
- LP oracle tests: [xrplLpOracleBot.spec.ts](test/unit/xrplLpOracleBot.spec.ts)
- Signed quorum helpers: [xrplLpOracleQuorum.ts](scripts/xrplLpOracleQuorum.ts)
- Median reporter deploy script: [deployMedianOracleReporter.ts](scripts/deployMedianOracleReporter.ts)
- Median reporter deployment integration test: [medianOracleDeployment.spec.ts](test/integration/medianOracleDeployment.spec.ts)
- LP oracle aggregator: [runXrplLpOracleAggregator.ts](scripts/runXrplLpOracleAggregator.ts)
- [config/liquidation-bot.example.json](config/liquidation-bot.example.json)

## Build

```bash
npm run compile
npm run test
```

## Deployment scripts

```bash
source .env.deploy.example
npm run deploy:full-stack

source .env.keeper.example
npm run deploy:keeper
```

Deployment helpers:

- Full XRPL EVM stack deploy: [deploySecurdStack.ts](scripts/deploySecurdStack.ts)
- Keeper wrapper deploy: [deployLiquidationKeeper.ts](scripts/deployLiquidationKeeper.ts)
- Example market config: [securd-markets.example.json](config/securd-markets.example.json)
- Example trusted GMP sources: [trusted-gmp-sources.example.json](config/trusted-gmp-sources.example.json)
- Example trusted ITS sources: [trusted-its-sources.example.json](config/trusted-its-sources.example.json)

- Unitroller admin acceptance script: [acceptUnitrollerAdmin.ts](scripts/acceptUnitrollerAdmin.ts)
- Deployment input schema utilities: [securdDeploymentConfig.ts](scripts/securdDeploymentConfig.ts)
- Example deployment record: [xrpl-evm-mainnet.example.json](deployments/xrpl-evm-mainnet.example.json)
- Testnet deployment record example: [xrpl-evm-testnet.example.json](deployments/xrpl-evm-testnet.example.json)
- Post-deploy verification script: [verifyDeployedSecurdStack.ts](scripts/verifyDeployedSecurdStack.ts)
- Deployment runbook: [13-deployment-runbook.md](docs/13-deployment-runbook.md)
- Deployment smoke check script: [smokeCheckDeployment.ts](scripts/smokeCheckDeployment.ts)
- Manifest signing helpers: [deploymentManifest.ts](scripts/deploymentManifest.ts), [signDeploymentManifest.ts](scripts/signDeploymentManifest.ts), [verifyDeploymentManifest.ts](scripts/verifyDeploymentManifest.ts)
- Release promotion checklist: [14-release-promotion-checklist.md](docs/14-release-promotion-checklist.md)

## Testing

Securd includes unit, integration, and property-style safety tests.

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:properties
npm run typecheck
npm run validate:liquidation-config
npm run validate:deploy-inputs
npm run validate:deployment-record
npm run smoke:deployment
npm run verify:deployment
npm run sign:deployment-manifest
npm run verify:deployment-manifest
npm run coverage
npm run coverage:check
```

Test layout:

- `test/unit/`: focused contract behavior and admin/control logic
- `test/integration/`: end-to-end lending, bridge, and market execution flows
- `test/invariant/`: property-style safety tests for lending health and bridge ordering/replay behavior

Coverage threshold enforcement:

- `npm run coverage` generates the Istanbul report
- `npm run coverage:check` enforces the repository thresholds used in CI
- current CI thresholds:
  - statements: `80%`
  - functions: `80%`
  - branches: `55%`
  - lines: `78%`

## CI/CD

The repository includes GitHub Actions workflows for:

- `CI`: compile, unit tests, integration tests, property tests, LP-oracle tests, config validation, and coverage
- `CD`: manual environment-gated deployment and verification actions for testnet and mainnet
- `Release`: GitHub release creation from version tags such as `v0.1.0`

Workflow files:

- [.github/workflows/ci.yml](.github/workflows/ci.yml)
- [.github/workflows/cd.yml](.github/workflows/cd.yml)
- [.github/workflows/release.yml](.github/workflows/release.yml)

Recommended GitHub Actions configuration:

- keep sensitive values in GitHub `secrets`
  - `DEPLOYER_PRIVATE_KEY`
  - `XRPL_EVM_RPC_URL` if your provider URL is private
- keep non-sensitive deployment configuration in GitHub environment `vars`
  - chain ids
  - contract addresses
  - owner/admin addresses
  - deployment file paths
  - numeric protocol parameters

Current tested scope includes:

- XRPL-Axelar signed-intent execution and replay protection
- Securd price oracle selection and fallback safety
- deterministic XRPL user proxy lifecycle
- liquidation keeper controls
- core lending markets, controller policy, and liquidation behavior
- monotonic liquidity and shortfall safety properties

## Keeper deployment

Deploy the liquidation keeper wrapper with the owner address and optional initial executor and limit configuration.

```bash
KEEPER_OWNER=0xYourOwner \
KEEPER_EXECUTORS=0xKeeper1,0xKeeper2 \
KEEPER_ASSET_LIMITS='[{"asset":"0xAsset","limit":"100000000"}]' \
KEEPER_MARKET_LIMITS='[{"market":"0xMarket","limit":"50000000"}]' \
npx hardhat run scripts/deployLiquidationKeeper.ts --network xrplEvm
```

Only `KEEPER_OWNER` is required. The optional JSON environment variables let you seed initial treasury control limits during deployment.

## Liquidation bot config validation

The example bot config is stored at [liquidation-bot.example.json](config/liquidation-bot.example.json).

- `npm run typecheck` validates the TypeScript script surface, including the config schema helpers.
- `npm run validate:liquidation-config` parses and validates the example config against [liquidationBotConfig.ts](scripts/liquidationBotConfig.ts).
- CI now runs both checks automatically.
- `npm run validate:deploy-inputs` validates the example market and trusted-source deployment inputs.
- `npm run validate:deployment-record` validates the recorded deployment JSON shape.
- `npm run accept:unitroller-admin` finalizes Unitroller admin handoff from the pending admin wallet.
- `npm run verify:deployment` checks the deployed XRPL EVM contracts against the deployment record and optional config inputs.
- `npm run smoke:deployment` performs a lightweight live check of ownership and admin pointers.
- `npm run sign:deployment-manifest` signs a deployment record with an operator key.
- `npm run verify:deployment-manifest` verifies a signed manifest against the deployment record.
- CI now runs the deployment-input validation alongside tests and bot-config validation.

## Example environment files

- Full stack deploy env: [.env.deploy.example](.env.deploy.example)
- Keeper deploy env: [.env.keeper.example](.env.keeper.example)
- Bot ops env: [.env.bot.example](.env.bot.example)
- Manifest signing env: [.env.manifest.example](.env.manifest.example)

These examples are meant to be copied into real operator-specific env files outside version control.

## Important implementation notes

- Axelar contracts are imported from official packages; they are not duplicated locally.
- The bridge adapter requires both Axelar source validation and a configured per-account intent signer.
- Reward-token transfer logic is disabled in the current deployment profile.
- The oracle supports Chainlink, Band, and a bot-updated fallback path for assets such as XRPL Ledger LP collateral.
- GitHub Actions CI runs compile, unit tests, integration tests, property-style tests, and coverage via [.github/workflows/ci.yml](.github/workflows/ci.yml).
