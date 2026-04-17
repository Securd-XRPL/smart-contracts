# GitHub Actions Environment Setup

This document explains exactly how to configure GitHub Actions environments for
Securd.

The repository uses:

- `CI` for compile, tests, validation, and coverage
- `CD` for manual environment-gated deployment and verification
- `Release` for tag-based GitHub releases

## 1. Create environments

In GitHub:

1. open the repository
2. go to `Settings`
3. go to `Environments`
4. create:
   - `testnet`
   - `mainnet`

Recommended protection:

- `testnet`
  - optional reviewer
- `mainnet`
  - required reviewer
  - restrict deployment to `main`

## 2. What goes into GitHub secrets

These values are sensitive and should be stored as environment `secrets`.

### 2.1 Testnet secrets

```text
XRPL_EVM_RPC_URL
DEPLOYER_PRIVATE_KEY
```

### 2.2 Mainnet secrets

```text
XRPL_EVM_RPC_URL
DEPLOYER_PRIVATE_KEY
```

If your RPC URL is public and not sensitive, you may move it to `vars`, but the
current workflow supports it safely as a secret.

## 3. What goes into GitHub vars

These values are not secrets and should be stored as environment `vars`.

### 3.1 Testnet vars

```text
XRPL_EVM_CHAIN_ID
DEPLOY_OWNER
SECURD_PENDING_ADMIN
AXELAR_GATEWAY
INTERCHAIN_TOKEN_SERVICE
XRPL_DESTINATION_CHAIN
XRPL_EGRESS_GAS_VALUE
SECURD_PAUSE_GUARDIAN
SECURD_BORROW_CAP_GUARDIAN
BAND_STD_REFERENCE
SECURD_CLOSE_FACTOR_MANTISSA
SECURD_LIQUIDATION_INCENTIVE_MANTISSA
SECURD_IRM_BASE_RATE_PER_YEAR
SECURD_IRM_MULTIPLIER_PER_YEAR
SECURD_IRM_JUMP_MULTIPLIER_PER_YEAR
SECURD_IRM_KINK
SECURD_MARKETS_FILE
XRPL_TRUSTED_GMP_SOURCES_FILE
XRPL_TRUSTED_ITS_SOURCES_FILE
DEPLOYMENT_OUTPUT_FILE
KEEPER_OWNER
KEEPER_EXECUTORS
KEEPER_ASSET_LIMITS
KEEPER_MARKET_LIMITS
MEDIAN_REPORTER_OWNER
MEDIAN_REPORTER_FALLBACK_ORACLE
MEDIAN_REPORTER_ASSET_CONFIGS
MEDIAN_REPORTER_REPORTERS
SECURD_DEPLOY_MEDIAN_ORACLE_REPORTER
SECURD_MEDIAN_REPORTER_OWNER
SECURD_MEDIAN_REPORTER_CONFIG
SECURD_MEDIAN_REPORTER_REPORTERS
```

### 3.2 Mainnet vars

```text
XRPL_EVM_CHAIN_ID
DEPLOY_OWNER
SECURD_PENDING_ADMIN
AXELAR_GATEWAY
INTERCHAIN_TOKEN_SERVICE
XRPL_DESTINATION_CHAIN
XRPL_EGRESS_GAS_VALUE
SECURD_PAUSE_GUARDIAN
SECURD_BORROW_CAP_GUARDIAN
BAND_STD_REFERENCE
SECURD_CLOSE_FACTOR_MANTISSA
SECURD_LIQUIDATION_INCENTIVE_MANTISSA
SECURD_IRM_BASE_RATE_PER_YEAR
SECURD_IRM_MULTIPLIER_PER_YEAR
SECURD_IRM_JUMP_MULTIPLIER_PER_YEAR
SECURD_IRM_KINK
SECURD_MARKETS_FILE
XRPL_TRUSTED_GMP_SOURCES_FILE
XRPL_TRUSTED_ITS_SOURCES_FILE
DEPLOYMENT_OUTPUT_FILE
KEEPER_OWNER
KEEPER_EXECUTORS
KEEPER_ASSET_LIMITS
KEEPER_MARKET_LIMITS
MEDIAN_REPORTER_OWNER
MEDIAN_REPORTER_FALLBACK_ORACLE
MEDIAN_REPORTER_ASSET_CONFIGS
MEDIAN_REPORTER_REPORTERS
SECURD_DEPLOY_MEDIAN_ORACLE_REPORTER
SECURD_MEDIAN_REPORTER_OWNER
SECURD_MEDIAN_REPORTER_CONFIG
SECURD_MEDIAN_REPORTER_REPORTERS
```

## 4. Recommended default values

Use these values unless your deployment policy requires different ones.

```text
XRPL_EGRESS_GAS_VALUE=0
SECURD_CLOSE_FACTOR_MANTISSA=500000000000000000
SECURD_LIQUIDATION_INCENTIVE_MANTISSA=1080000000000000000
SECURD_IRM_BASE_RATE_PER_YEAR=0
SECURD_IRM_MULTIPLIER_PER_YEAR=0
SECURD_IRM_JUMP_MULTIPLIER_PER_YEAR=0
SECURD_IRM_KINK=800000000000000000
SECURD_MARKETS_FILE=config/securd-markets.example.json
XRPL_TRUSTED_GMP_SOURCES_FILE=config/trusted-gmp-sources.example.json
XRPL_TRUSTED_ITS_SOURCES_FILE=config/trusted-its-sources.example.json
SECURD_DEPLOY_MEDIAN_ORACLE_REPORTER=false
```

Per environment:

```text
testnet: DEPLOYMENT_OUTPUT_FILE=deployments/xrpl-evm-testnet.json
mainnet: DEPLOYMENT_OUTPUT_FILE=deployments/xrpl-evm-mainnet.json
```

## 5. If keeper and reporter are not used yet

If you are not deploying the keeper or the median reporter yet, these values can
be left unset initially:

```text
KEEPER_EXECUTORS
KEEPER_ASSET_LIMITS
KEEPER_MARKET_LIMITS
MEDIAN_REPORTER_OWNER
MEDIAN_REPORTER_FALLBACK_ORACLE
MEDIAN_REPORTER_ASSET_CONFIGS
MEDIAN_REPORTER_REPORTERS
SECURD_MEDIAN_REPORTER_OWNER
SECURD_MEDIAN_REPORTER_CONFIG
SECURD_MEDIAN_REPORTER_REPORTERS
```

## 6. GitHub UI setup checklist

### 6.1 Testnet

1. go to `Settings -> Environments -> testnet`
2. add the required `secrets`
3. add the `vars`
4. run the `CD` workflow with:
   - `environment = testnet`
   - `action = validate-only`
5. if successful, run:
   - `environment = testnet`
   - `action = deploy-full-stack`
6. then run:
   - `verify-deployment`
7. then run:
   - `smoke-deployment`

### 6.2 Mainnet

1. go to `Settings -> Environments -> mainnet`
2. add required reviewer protection
3. add the required `secrets`
4. add the `vars`
5. run the same sequence:
   - `validate-only`
   - `deploy-full-stack`
   - `verify-deployment`
   - `smoke-deployment`

## 7. CSV-style reference

### 7.1 Secrets

```text
environment,name
testnet,XRPL_EVM_RPC_URL
testnet,DEPLOYER_PRIVATE_KEY
mainnet,XRPL_EVM_RPC_URL
mainnet,DEPLOYER_PRIVATE_KEY
```

### 7.2 Vars

```text
environment,name
testnet,XRPL_EVM_CHAIN_ID
testnet,DEPLOY_OWNER
testnet,SECURD_PENDING_ADMIN
testnet,AXELAR_GATEWAY
testnet,INTERCHAIN_TOKEN_SERVICE
testnet,XRPL_DESTINATION_CHAIN
testnet,XRPL_EGRESS_GAS_VALUE
testnet,SECURD_PAUSE_GUARDIAN
testnet,SECURD_BORROW_CAP_GUARDIAN
testnet,BAND_STD_REFERENCE
testnet,SECURD_CLOSE_FACTOR_MANTISSA
testnet,SECURD_LIQUIDATION_INCENTIVE_MANTISSA
testnet,SECURD_IRM_BASE_RATE_PER_YEAR
testnet,SECURD_IRM_MULTIPLIER_PER_YEAR
testnet,SECURD_IRM_JUMP_MULTIPLIER_PER_YEAR
testnet,SECURD_IRM_KINK
testnet,SECURD_MARKETS_FILE
testnet,XRPL_TRUSTED_GMP_SOURCES_FILE
testnet,XRPL_TRUSTED_ITS_SOURCES_FILE
testnet,DEPLOYMENT_OUTPUT_FILE
mainnet,XRPL_EVM_CHAIN_ID
mainnet,DEPLOY_OWNER
mainnet,SECURD_PENDING_ADMIN
mainnet,AXELAR_GATEWAY
mainnet,INTERCHAIN_TOKEN_SERVICE
mainnet,XRPL_DESTINATION_CHAIN
mainnet,XRPL_EGRESS_GAS_VALUE
mainnet,SECURD_PAUSE_GUARDIAN
mainnet,SECURD_BORROW_CAP_GUARDIAN
mainnet,BAND_STD_REFERENCE
mainnet,SECURD_CLOSE_FACTOR_MANTISSA
mainnet,SECURD_LIQUIDATION_INCENTIVE_MANTISSA
mainnet,SECURD_IRM_BASE_RATE_PER_YEAR
mainnet,SECURD_IRM_MULTIPLIER_PER_YEAR
mainnet,SECURD_IRM_JUMP_MULTIPLIER_PER_YEAR
mainnet,SECURD_IRM_KINK
mainnet,SECURD_MARKETS_FILE
mainnet,XRPL_TRUSTED_GMP_SOURCES_FILE
mainnet,XRPL_TRUSTED_ITS_SOURCES_FILE
mainnet,DEPLOYMENT_OUTPUT_FILE
```
