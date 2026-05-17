/**
 * Opens a trustline on the XRPL Ledger wallet for an IOU token.
 * Required before receiving any IOU (e.g. STST) via Axelar ITS bridge.
 *
 * Required env vars:
 *   XRPL_SEED            Funded XRPL testnet seed
 *
 * Optional env vars:
 *   XRPL_RPC_URL         default: wss://s.altnet.rippletest.net:51233
 *   XRPL_CONFIRM_SEND    Set to "true" to actually submit (default: dry-run)
 *
 * Override token details via env or edit the constants below:
 *   TRUSTLINE_CURRENCY   Hex currency code (e.g. 5354535400000000000000000000000000000000)
 *   TRUSTLINE_ISSUER     Issuer r-address
 *   TRUSTLINE_LIMIT      Trust limit (default: 1000000000)
 */
import { Client, TrustSet, Wallet } from "xrpl";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

async function main() {
  const xrplRpcUrl  = optionalEnv("XRPL_RPC_URL", "wss://s.altnet.rippletest.net:51233");
  const xrplSeed    = requiredEnv("XRPL_SEED");
  const currency    = optionalEnv("TRUSTLINE_CURRENCY", "5354535400000000000000000000000000000000");
  const issuer      = optionalEnv("TRUSTLINE_ISSUER",   "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const limit       = optionalEnv("TRUSTLINE_LIMIT",    "1000000000");
  const confirmSend = process.env.XRPL_CONFIRM_SEND === "true";

  const wallet = Wallet.fromSeed(xrplSeed);

  const tx: TrustSet = {
    TransactionType: "TrustSet",
    Account: wallet.address,
    LimitAmount: {
      currency,
      issuer,
      value: limit,
    },
  };

  console.log(JSON.stringify({
    dryRun:   !confirmSend,
    account:  wallet.address,
    currency,
    issuer,
    limit,
  }, null, 2));

  if (!confirmSend) {
    console.log("\nSet XRPL_CONFIRM_SEND=true to submit this TrustSet transaction.");
    return;
  }

  const client = new Client(xrplRpcUrl);
  await client.connect();
  try {
    const prepared = await client.autofill(tx);
    const signed   = wallet.sign(prepared);
    const result   = await client.submitAndWait(signed.tx_blob);
    console.log(JSON.stringify(result, null, 2));
    const outcome = (result.result.meta as any)?.TransactionResult;
    if (outcome === "tesSUCCESS") {
      console.log(`\nTrustline opened. XRPL tx: https://testnet.xrpl.org/transactions/${result.result.hash}`);
    } else {
      console.error(`\nTransaction failed: ${outcome}`);
      process.exitCode = 1;
    }
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
