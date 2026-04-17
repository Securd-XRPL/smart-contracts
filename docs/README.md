# Securd Documentation Index

This documentation set replaces the previous inherited protocol notes and documents the active Securd design only.

## Documents

1. [01-system-architecture.md](01-system-architecture.md)
Describes the full architecture, component boundaries, trust assumptions, and protocol data model.

2. [02-contract-reference.md](02-contract-reference.md)
Explains every active contract in `contracts/core` and `contracts/xrpl-axelar-integration`, including responsibilities and interactions.

3. [03-security-model.md](03-security-model.md)
Covers authorization, replay protection, source validation, oracle controls, operational security, and failure domains.

4. [04-user-flows.md](04-user-flows.md)
Provides detailed step-by-step supply, repay, borrow, withdraw, and liquidation-related system flows.

5. [05-xrpl-ledger-transaction-model.md](05-xrpl-ledger-transaction-model.md)
Explains the XRPL Ledger transaction shape used to initiate protocol actions, with emphasis on Payment transactions, payload packaging, and bridge handoff.

6. [06-sequence-diagrams.md](06-sequence-diagrams.md)
Mermaid sequence diagrams for the major execution paths.

7. [07-deployment-configuration.md](07-deployment-configuration.md)
Deployment inputs, post-deploy configuration, and go-live checklist.

8. [08-operator-runbook.md](08-operator-runbook.md)
Operational runbook for the XRPL-side relayer, fallback oracle bot, and protocol operators.

9. [09-liquidation-strategy.md](09-liquidation-strategy.md)
Liquidation treasury design, keeper policy, and safe handling of fallback-priced LP collateral.

10. [10-liquidation-bot-spec.md](10-liquidation-bot-spec.md)
Concrete liquidation bot inputs, logic, and safety checks.

11. [11-treasury-sizing-worksheet.md](11-treasury-sizing-worksheet.md)
Operational worksheet for liquidation treasury sizing by asset.

12. [12-keeper-wrapper-design.md](12-keeper-wrapper-design.md)
Optional onchain wrapper design for treasury-controlled liquidation execution.

13. [13-deployment-runbook.md](13-deployment-runbook.md)
Operator deployment sequence, admin handoff, verification, and go-live checklist.

14. [14-release-promotion-checklist.md](14-release-promotion-checklist.md)
Promotion checklist from testnet validation to mainnet release.

15. [15-xrpl-lp-oracle-bot.md](15-xrpl-lp-oracle-bot.md)
How to value XRPL AMM LP tokens in real time, publish prices safely to the fallback oracle, and decentralize LP reporting over time.

## Test commands

Use the following commands from the repository root:

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:properties
npm run typecheck
npm run validate:liquidation-config
npm run validate:lp-oracle-config
npm run test:lp-oracle
npm run test:lp-oracle:full
npm run deploy:median-oracle-reporter
npm run aggregate:lp-oracle
npm run validate:deploy-inputs
npm run validate:deployment-record
npm run smoke:deployment
npm run verify:deployment
npm run sign:deployment-manifest
npm run verify:deployment-manifest
npm run coverage
npm run coverage:check
```

Test directories:

- `test/unit/`: unit tests
- `test/integration/`: integration tests
- `test/invariant/`: property-style safety tests

## Reading order

For a new engineer or auditor, the best order is:

1. system architecture
2. contract reference
3. security model
4. user flows
5. XRPL Ledger transaction model
6. sequence diagrams
7. deployment configuration
8. operator runbook
9. liquidation strategy
10. bot spec
11. treasury sizing worksheet
12. keeper-wrapper design

## Operational validation

- Keeper deployment script: [deployLiquidationKeeper.ts](../scripts/deployLiquidationKeeper.ts)
- Liquidation bot config schema: [liquidationBotConfig.ts](../scripts/liquidationBotConfig.ts)
- Liquidation bot config validator: [validateLiquidationBotConfig.ts](../scripts/validateLiquidationBotConfig.ts)
- Example config: [liquidation-bot.example.json](../config/liquidation-bot.example.json)
- XRPL LP oracle config schema: [xrplLpOracleConfig.ts](../scripts/xrplLpOracleConfig.ts)
- XRPL LP oracle config validator: [validateXrplLpOracleConfig.ts](../scripts/validateXrplLpOracleConfig.ts)
- XRPL LP oracle bot scaffold: [runXrplLpOracleBot.ts](../scripts/runXrplLpOracleBot.ts)
- XRPL LP oracle quorum helpers: [xrplLpOracleQuorum.ts](../scripts/xrplLpOracleQuorum.ts)
- Median reporter deploy script: [deployMedianOracleReporter.ts](../scripts/deployMedianOracleReporter.ts)
- XRPL LP oracle aggregator: [runXrplLpOracleAggregator.ts](../scripts/runXrplLpOracleAggregator.ts)
- Example signed report bundle: [xrpl-lp-signed-reports.example.json](../config/xrpl-lp-signed-reports.example.json)
- Full deployment schema helpers: [securdDeploymentConfig.ts](../scripts/securdDeploymentConfig.ts)
- Deployment input validator: [validateSecurdDeploymentInputs.ts](../scripts/validateSecurdDeploymentInputs.ts)
- Deployment record validator: [validateDeploymentRecord.ts](../scripts/validateDeploymentRecord.ts)
- Unitroller admin acceptance script: [acceptUnitrollerAdmin.ts](../scripts/acceptUnitrollerAdmin.ts)
- Example deployment record: [xrpl-evm-mainnet.example.json](../deployments/xrpl-evm-mainnet.example.json)
- Testnet deployment record example: [xrpl-evm-testnet.example.json](../deployments/xrpl-evm-testnet.example.json)
- Post-deploy verification script: [verifyDeployedSecurdStack.ts](../scripts/verifyDeployedSecurdStack.ts)
- Deployment runbook: [13-deployment-runbook.md](13-deployment-runbook.md)
- Deployment smoke check: [smokeCheckDeployment.ts](../scripts/smokeCheckDeployment.ts)
- Manifest signing helpers: [deploymentManifest.ts](../scripts/deploymentManifest.ts), [signDeploymentManifest.ts](../scripts/signDeploymentManifest.ts), [verifyDeploymentManifest.ts](../scripts/verifyDeploymentManifest.ts)
- Release promotion checklist: [14-release-promotion-checklist.md](14-release-promotion-checklist.md)

- Full stack deploy script: [deploySecurdStack.ts](../scripts/deploySecurdStack.ts)
- Full stack deploy env example: [.env.deploy.example](../.env.deploy.example)
- Keeper deploy env example: [.env.keeper.example](../.env.keeper.example)
- Bot ops env example: [.env.bot.example](../.env.bot.example)
- Manifest signing env example: [.env.manifest.example](../.env.manifest.example)
- Example market deployment config: [securd-markets.example.json](../config/securd-markets.example.json)
- Trusted GMP source example: [trusted-gmp-sources.example.json](../config/trusted-gmp-sources.example.json)
- Trusted ITS source example: [trusted-its-sources.example.json](../config/trusted-its-sources.example.json)
- XRPL LP oracle config example: [xrpl-lp-oracle.example.json](../config/xrpl-lp-oracle.example.json)
- Median reporter contract: [SecurdMedianOracleReporter.sol](../contracts/core/SecurdMedianOracleReporter.sol)
