# Securd Deployment Runbook

This runbook describes the recommended deployment sequence for Securd on XRPL EVM.

## Inputs

Prepare the following before deployment:

- `.env.deploy` derived from [.env.deploy.example](../.env.deploy.example)
- market config derived from [securd-markets.example.json](../config/securd-markets.example.json)
- trusted GMP sources derived from [trusted-gmp-sources.example.json](../config/trusted-gmp-sources.example.json)
- trusted ITS sources derived from [trusted-its-sources.example.json](../config/trusted-its-sources.example.json)
- final owner / multisig address
- pending Unitroller admin address

## Step 1: Validate inputs locally

Run these checks before any onchain transaction:

```bash
npm run typecheck
npm run validate:deploy-inputs
npm run validate:liquidation-config
```

## Step 2: Deploy the full stack

```bash
source .env.deploy
npm run deploy:full-stack
```

Expected outputs:

- Unitroller
- Comptroller implementation
- SecurdPriceOracle
- JumpRateModelV2
- CErc20Delegate implementation
- SecurdLiquidationKeeper
- XRPLUserProxyFactory
- XRPLSecurdBridgeAdapter
- configured cToken markets
- deployment summary JSON written to `DEPLOYMENT_OUTPUT_FILE`

## Step 3: Validate the deployment record

```bash
npm run validate:deployment-record
```

If using a non-example output path, run:

```bash
ts-node scripts/validateDeploymentRecord.ts deployments/your-output.json
```

## Step 4: Accept Unitroller admin from the final admin wallet

The deploy script sets `pendingAdmin` on Unitroller but does not auto-accept from a different wallet.

From the pending admin signer:

```bash
export UNITROLLER_ADDRESS=0xYourUnitroller
npm run accept:unitroller-admin
```

## Step 5: Verify deployed state on XRPL EVM

```bash
export DEPLOYMENT_RECORD_FILE=deployments/your-output.json
source .env.deploy
npx hardhat run scripts/verifyDeployedSecurdStack.ts --network xrplEvm
```

The verification and smoke-check scripts accept either of these valid Unitroller states:
- admin handoff still pending after deployment
- admin handoff already accepted by the final admin wallet

This verifies:

- contract ownerships
- Unitroller pending admin
- Comptroller oracle pointer
- proxy factory controller
- bridge destination chain when provided
- listed markets and collateral factors when market config is provided
- trusted GMP and ITS sources when source config files are provided

## XRPL EVM testnet Axelar addresses

For XRPL EVM testnet, configure the adapter with the live Axelar relayer stack in
[axelar-xrpl-evm-testnet.example.json](../config/axelar-xrpl-evm-testnet.example.json).

The most important values for XRPL-originated transfers are:

```bash
INTERCHAIN_TOKEN_SERVICE=0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C
AXELAR_GATEWAY=0xe432150cce91c13a887f7D836923d5597adD8E31
```

`XRPLSecurdBridgeAdapter` stores the ITS address immutably. If
`executeWithInterchainToken` is reverting with `NotInterchainTokenService`, the adapter
was deployed with an ITS address that differs from the live relayer sender. Update the
deployment environment and redeploy the adapter or full stack; changing trusted ITS
sources will not change the required `msg.sender`.

For raw Axelar callback tests, the current Axelar testnet wXRP token id is
`0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f` and its XRPL EVM
representation is `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.

Do not assume that sentinel can be dropped directly into an ERC20 lending market. The current
adapter executes ERC20 `transfer` and `approve` calls for `SUPPLY` and `REPAY`, so lending
execution still needs an ERC20-compatible underlying or explicit native-token handling.

## Step 6: Deploy and seed the liquidation keeper

```bash
source .env.keeper
npm run deploy:keeper
```

Then fund the keeper treasury and authorize execution bots according to your operational policy.

## Step 7: Prepare bot operations

Create a runtime env derived from [.env.bot.example](../.env.bot.example) and point it to a real bot config derived from [liquidation-bot.example.json](../config/liquidation-bot.example.json).

Run:

```bash
npm run validate:liquidation-config
```

For XRPL LP collateral with decentralized reporting, operators can deploy the
median reporter separately:

```bash
source .env.deploy.example
npm run deploy:median-oracle-reporter
```

Then run the offchain aggregator against signed observer reports:

```bash
export LP_ORACLE_CHAIN_ID=1440002
export LP_ORACLE_REPORTER_CONTRACT=0xYourMedianReporter
export LP_ORACLE_MIN_SIGNERS=2
export LP_ORACLE_MAX_SPREAD_BPS=1000
export LP_ORACLE_SIGNED_REPORTS_FILE=config/xrpl-lp-signed-reports.example.json
export LP_ORACLE_AGGREGATOR_PRIVATE_KEY=0xYourAggregatorPrivateKey
npm run aggregate:lp-oracle
```

Recommended sequence:

- observers sign EIP-712 LP reports offchain
- aggregator verifies signer quorum, spread bounds, nonce, and expiry
- aggregator submits the accepted reports to the median reporter
- median reporter finalizes and forwards the result to [SecurdPriceOracle.sol](../contracts/core/SecurdPriceOracle.sol)

## Step 8: Go-live checklist

- deployment record stored under `deployments/`
- deployment record validated
- Unitroller admin accepted by final admin wallet
- post-deploy verification script passed
- oracle sources configured and tested
- fallback LP price bot running
- keeper wrapper deployed and funded
- liquidation bot configured
- Axelar trusted sources confirmed
- monitoring and alerts enabled

## Recommended file outputs

- `deployments/xrpl-evm-testnet.json`
- `deployments/xrpl-evm-mainnet.json`
- operator-specific env files kept outside version control
