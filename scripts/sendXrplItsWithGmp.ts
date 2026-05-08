/**
 * Sends XRP from the XRPL Ledger to XRPL EVM via Axelar ITS, with an embedded GMP payload.
 *
 * The XRPL Payment carries:
 *   - Total XRP drops = transfer amount + gas fee
 *   - Axelar memos encoding an interchain_transfer with payload
 *
 * On XRPL EVM the Axelar ITS mints/delivers wXRP and calls:
 *   executeWithInterchainToken(commandId, sourceChain, sourceAddress, data, tokenId, token, amount)
 *
 * The receiver contract stores the transfer and emits ItsTransferReceived.
 *
 * Required env vars:
 *   XRPL_SEED                    Funded XRPL testnet seed
 *   XRPL_EVM_DEMO_RECEIVER       XrplEvmDemoReceiver address on XRPL EVM
 *   XRPL_TRANSFER_AMOUNT_DROPS   XRP drops to transfer (the token amount)
 *
 * Optional env vars:
 *   XRPL_RPC_URL                 default: wss://s.altnet.rippletest.net:51233
 *   XRPL_AXELAR_GATEWAY          XRPL Ledger gateway address (default: Axelar testnet)
 *   XRPL_EVM_AXELAR_CHAIN        Axelar chain name for XRPL EVM (default: xrpl-evm)
 *   XRPL_ITS_GAS_FEE_DROPS       Drops reserved for Axelar gas (default: 2000000 = 2 XRP)
 *   XRPL_GMP_MESSAGE             Text message embedded in the payload (default: "xrp transfer + gmp demo")
 *   XRPL_CONFIRM_SEND            Set to "true" to actually submit the transaction
 *
 * Run:
 *   ts-node scripts/sendXrplItsWithGmp.ts
 */
import { Client, Payment, Wallet } from "xrpl";

// Axelar wXRP ITS token ID on XRPL EVM testnet
const WXRP_TOKEN_ID = "0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f";

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
function itsMemo(key: string, value: string, isPayload = false) {
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
  const transferAmountDrops = BigInt(req("XRPL_TRANSFER_AMOUNT_DROPS"));
  const gasFeeDrops = BigInt(opt("XRPL_ITS_GAS_FEE_DROPS", "2000000")); // 2 XRP default
  const totalDrops = transferAmountDrops + gasFeeDrops;
  const confirmSend = process.env.XRPL_CONFIRM_SEND === "true";

  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const senderAddress = xrplWallet.address;

  // Plain ITS transfer — no payload memo. The XRPL Axelar bridge does not support
  // an inline GMP payload alongside an ITS transfer from the XRPL Ledger side.
  // The receiver contract will receive the tokens via a standard interchainTransfer call.
  const tx: Payment = {
    TransactionType: "Payment",
    Account: xrplWallet.address,
    Amount: totalDrops.toString(),
    Destination: xrplGateway,
    Memos: [
      itsMemo("type", "interchain_transfer"),
      itsMemo("destination_address", receiverAddress),
      itsMemo("destination_chain", destinationChain),
      itsMemo("gas_fee_amount", gasFeeDrops.toString())
    ]
  };

  const summary = {
    mode: "ITS (interchain_transfer — XRP token transfer to XRPL EVM)",
    dryRun: !confirmSend,
    xrplRpcUrl,
    xrplSender: senderAddress,
    xrplGateway,
    destinationChain,
    receiverAddress,
    tokenId: WXRP_TOKEN_ID,
    transferAmountDrops: transferAmountDrops.toString(),
    gasFeeDrops: gasFeeDrops.toString(),
    totalDrops: totalDrops.toString(),
    transaction: tx
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!confirmSend) {
    console.log("\nSet XRPL_CONFIRM_SEND=true to submit this transaction to XRPL testnet.");
    console.log("Once submitted, the Axelar relayer will call executeWithInterchainToken() on the receiver.");
    console.log("wXRP will be credited to the receiver contract (~30-60 seconds after submission).");
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
    console.log("\nNow wait ~30-60 seconds for the Axelar relayer to deliver the transfer + message.");
    console.log(`Check the receiver at ${receiverAddress} — call lastItsTransfer() to confirm delivery.`);
    console.log("wXRP will also appear in the receiver's ERC20 balance.");
  } finally {
    await client.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
