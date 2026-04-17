# Contributing to Securd

Thanks for contributing to Securd.

This repository contains:

- Solidity smart contracts for the lending core
- XRPL-Axelar integration contracts
- deployment and operations scripts
- protocol docs and test suites

## Before you start

Please follow these rules for any contribution:

- never commit private keys, mnemonics, RPC secrets, webhook secrets, or `.env` files
- never commit generated folders such as `node_modules`, `artifacts`, `cache`, or `typechain-types`
- do not rename or remove core contracts casually; protocol integrations depend on stable interfaces
- keep docs aligned with code changes
- prefer small, reviewable changes over large mixed refactors

## Local setup

From the repository root:

```bash
npm ci
npm run typecheck
npm run compile
npm run test
```

Useful focused commands:

```bash
npm run test:unit
npm run test:integration
npm run test:properties
npm run test:lp-oracle:full
npm run coverage
npm run coverage:check
```

## Project structure

- `contracts/core/`: lending core, oracle, keeper, and reporter contracts
- `contracts/xrpl-axelar-integration/`: cross-chain adapter and XRPL user proxy layer
- `scripts/`: deployment, validation, and operator tooling
- `test/`: unit, integration, and invariant-style tests
- `docs/`: architecture, security, and operator documentation
- `config/`: example operator configs

## Coding guidelines

### Solidity

- keep contracts ASCII-only unless there is a strong reason otherwise
- use clear NatSpec on externally relevant contracts and security-sensitive functions
- prefer explicit checks and custom errors for protocol-critical flows
- avoid unnecessary storage layout changes in inherited lending-core contracts

### TypeScript

- keep scripts operational and deterministic
- validate external config inputs before use
- avoid hidden environment assumptions
- use clear secret names such as `*_PRIVATE_KEY`

### Tests

- add or update tests for every behavior change
- prefer integration tests for protocol flow changes
- prefer unit tests for isolated policy, oracle, and helper logic
- keep negative-path coverage when changing authorization, replay, or oracle logic

## Pull request expectations

A good pull request should include:

- a short explanation of the change
- the risk or bug it addresses
- the commands you ran locally
- any required config or migration notes

If the change affects protocol behavior, include:

- affected contracts
- affected user flows
- whether docs were updated

## Security-sensitive changes

For changes affecting any of the following, be extra conservative:

- collateral factors
- liquidation behavior
- oracle logic
- bridge authorization
- replay protection
- signer or reporter validation
- deployment ownership or admin handoff

For suspected vulnerabilities, do not open a public issue first. Follow [SECURITY.md](SECURITY.md).
