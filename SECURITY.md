# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in Securd:

- do not open a public GitHub issue
- do not disclose the issue publicly before maintainers have time to assess it
- use a private reporting channel

Recommended path:

1. use GitHub private vulnerability reporting or a private security advisory if enabled for the repository
2. if that is not available, contact the repository maintainers directly through a private channel

Your report should include:

- affected contract, script, or workflow
- impact summary
- conditions required for exploitation
- proof of concept or reproduction steps if available
- suggested mitigation if you have one

## Scope

Security reports are especially important for:

- lending-core solvency logic
- liquidation rules
- oracle pricing and fallback publication
- XRPL-Axelar bridge authorization
- replay protection and intent signing
- admin ownership and deployment handoff
- keeper and reporter controls

## Disclosure expectations

Please give maintainers reasonable time to:

- validate the issue
- prepare a fix
- coordinate disclosure

We aim to:

- acknowledge receipt promptly
- triage severity
- communicate whether the issue is accepted, needs clarification, or is out of scope

## Secrets and operational safety

Never include any of the following in issues, pull requests, or public comments:

- private keys
- seed phrases or mnemonics
- RPC credentials
- webhook secrets
- deployment env files with real values

Only example placeholders such as `0xYOUR_PRIVATE_KEY` should appear in the public repo.
