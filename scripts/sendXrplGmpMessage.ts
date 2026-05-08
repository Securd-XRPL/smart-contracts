/**
 * Sends a pure GMP (no token transfer) message from the XRPL Ledger to XrplEvmDemoReceiver
 * on XRPL EVM testnet via the Axelar gateway.
 *
 * The XRPL Payment carries a small XRP amount (for Axelar gas) and memos that encode:
 *   - type = "call_contract"
 *   - destination_chain = "xrpl-evm"
 *   - destination_address = XrplEvmDemoReceiver address
 *   - payload = abi.encode(senderAddress, message, xrpDrops)
 *
 * Required env vars:
 *   XRPL_SEED                   Funded XRPL testnet seed
 *   XRPL_EVM_DEMO_RECEIVER      XrplEvmDemoReceiver address on XRPL EVM
 *
 * Optional env vars:
 *   XRPL_RPC_URL                default: wss://s.altnet.rippletest.net:51233
 *   XRPL_AXELAR_GATEWAY         XRPL Ledger gateway address (default: Axelar testnet)
 *   XRPL_EVM_AXELAR_CHAIN       Axelar chain name for XRPL EVM (default: xrpl-evm)
 *   XRPL_GMP_GAS_DROPS          XRP drops to cover Axelar gas (default: 3000000 = 3 XRP)
 *   XRPL_GMP_MESSAGE            Text message to include (default: "hello from xrpl ledger")
 *   XRPL_CONFIRM_SEND           Set to "true" to actually submit the transaction
 *
 * Run:
 *   ts-node scripts/sendXrplGmpMessage.ts
 */
import { ethers } from "ethers";
import { Client, Payment, Wallet } from "xrpl";

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function utf8Hex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function rawHex(value: string): string {
  return (value.startsWith("0x") ? value.slice(2) : value).toUpperCase();
}

// Axelar XRPL bridge memo encoding rules (verified from working testnet transactions):
//   - MemoType: always UTF-8 hex of the key string
//   - destination_address: UTF-8 hex of lowercase address WITHOUT 0x prefix
//   - destination_chain, type, gas_fee_amount: UTF-8 hex of the value string
//   - payload: raw hex bytes (not UTF-8 encoded)
function gmpMemo(key: string, value: string, isPayload = false) {
  let memoData: string;
  if (isPayload) {
    memoData = rawHex(value);
  } else if (key === "destination_address") {
    const addr = value.replace(/^0x/, "");
    memoData = utf8Hex(addr);
  } else {
    memoData = utf8Hex(value);
  }
  return {
    Memo: {
      MemoType: utf8Hex(key),
      MemoData: memoData
    }
  };
}

async function main() {
  const xrplRpcUrl = opt("XRPL_RPC_URL", "wss://s.altnet.rippletest.net:51233");
  const xrplSeed = req("XRPL_SEED");
  const receiverAddress = req("XRPL_EVM_DEMO_RECEIVER");
  const xrplGateway = opt("XRPL_AXELAR_GATEWAY", "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const destinationChain = opt("XRPL_EVM_AXELAR_CHAIN", "xrpl-evm");
  const gasDrops = BigInt(opt("XRPL_GMP_GAS_DROPS", "3000000")); // 3 XRP default
  const userMessage = opt("XRPL_GMP_MESSAGE", "hello from xrpl ledger");
  const confirmSend = process.env.XRPL_CONFIRM_SEND === "true";

  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const senderAddress = xrplWallet.address;

  // Encode payload: (string sender, string message, uint256 xrpDrops)
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "uint256"],
    [senderAddress, userMessage, gasDrops]
  );

  const tx: Payment = {
    TransactionType: "Payment",
    Account: xrplWallet.address,
    // Pay gas amount only (no token being transferred)
    Amount: gasDrops.toString(),
    Destination: xrplGateway,
    Memos: [
      gmpMemo("type", "call_contract"),
      gmpMemo("destination_address", receiverAddress),
      gmpMemo("destination_chain", destinationChain),
      gmpMemo("payload", payload, true)
    ]
  };

  const summary = {
    mode: "GMP (call_contract — no token transfer)",
    dryRun: !confirmSend,
    xrplRpcUrl,
    xrplSender: senderAddress,
    xrplGateway,
    destinationChain,
    receiverAddress,
    gasDrops: gasDrops.toString(),
    message: userMessage,
    encodedPayload: payload,
    transaction: tx
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!confirmSend) {
    console.log("\nSet XRPL_CONFIRM_SEND=true to submit this transaction to XRPL testnet.");
    console.log("Once submitted, the Axelar relayer will call execute() on the receiver in ~30–60 seconds.");
    return;
  }

  const client = new Client(xrplRpcUrl);
  await client.connect();
  try {
    const prepared = await client.autofill(tx);
    console.log("\nPrepared transaction:", JSON.stringify(prepared, null, 2));
    const signed = xrplWallet.sign(prepared);
    console.log("\nSubmitting...");
    const result = await client.submitAndWait(signed.tx_blob);
    console.log("\nResult:", JSON.stringify(result, null, 2));

    const hash = (result as any).result?.hash;
    if (hash) {
      console.log(`\nXRPL tx: https://testnet.xrpl.org/transactions/${hash}`);
    }
    console.log("\nNow wait ~30-60 seconds for the Axelar relayer to deliver the message to XRPL EVM.");
    console.log(`Check the receiver at ${receiverAddress} — call lastGmpMessage() to confirm delivery.`);
  } finally {
    await client.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
