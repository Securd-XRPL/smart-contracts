/**
 * Sends a REPAY intent for STST from XRPL Ledger to XRPL EVM using the
 * two-transaction "Add Gas" flow instead of in-kind gas deduction.
 *
 * Why this script exists (separate from submitXrplStsTRepay.ts):
 * Axelar's verifier network does not have a configured gas price for every
 * IOU. STST has no in-kind gas price, so the interchain_transfer memo must
 * carry gas_fee_amount = "0" (the full STST amount is delivered, none is
 * skimmed for gas) and gas must instead be paid separately, in native XRP,
 * via a second "Add Gas" Payment sent to the Axelar XRPL gateway. That
 * second payment references the first transaction's hash as `msg_id` so
 * Axelar can match the top-up to the underfunded message.
 *
 * Transaction 1 — interchain_transfer (STST, gas_fee_amount = "0"):
 *   Amount  = repay amount only (no gas added on top)
 *   Memos   = type, destination_address, destination_chain, gas_fee_amount="0", payload
 *
 * Transaction 2 — Add Gas (native XRP):
 *   Account     = same XRPL sender
 *   Destination = Axelar XRPL gateway
 *   Amount      = XRPL_ADD_GAS_DROPS, in drops
 *   Memos       = type="add_gas", msg_id=<tx1 hash, lowercase, no 0x prefix>
 *
 * Intent envelope amount = repay portion only (unaffected by the gas split).
 *
 * Amount scaling: XRPL IOU value "2" → EVM amount = parseEther("2") = 2e18 wei.
 *
 * Required env vars:
 *   XRPL_SEED                XRPL testnet wallet seed
 *   XRPL_EVM_RPC_URL         XRPL EVM RPC endpoint
 *   DEPLOYER_PRIVATE_KEY     Intent signer private key
 *   XRPL_BRIDGE_ADAPTER      XRPLSecurdBridgeAdapter address
 *   XRPL_STST_MARKET         sSTST cToken address
 *   XRPL_STST_UNDERLYING     STST ERC-20 address on XRPL EVM
 *   XRPL_STST_REPAY_AMOUNT   Amount to repay as human-readable string (e.g. "2")
 *
 * Optional:
 *   XRPL_RPC_URL             default: wss://s.altnet.rippletest.net:51233
 *   XRPL_AXELAR_GATEWAY      default: rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
 *   XRPL_EVM_AXELAR_CHAIN    default: xrpl-evm
 *   XRPL_STST_CURRENCY       XRPL hex currency code (default: 5354535400...)
 *   XRPL_STST_ISSUER         XRPL IOU issuer (default: Axelar testnet gateway)
 *   XRPL_ADD_GAS_DROPS       Native XRP drops sent in the Add Gas top-up (default: "2000000" = 2 XRP)
 *   XRPL_CONFIRM_SEND        Set to "true" to submit both transactions
 *
 * Run:
 *   ts-node scripts/submitXrplStsTRepayAddGas.ts
 */
import { ethers } from "ethers";
import { Client, Payment, IssuedCurrencyAmount, Wallet } from "xrpl";

const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

const ADAPTER_ABI = [
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
  "function marketConfigOf(address) view returns (address underlying, bytes32 tokenId, bool listed)",
];

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function utf8Hex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function rawHex(value: string): string {
  return (value.startsWith("0x") ? value.slice(2) : value).toUpperCase();
}

function buildMemo(key: string, value: string, isPayload = false) {
  let memoData: string;
  if (isPayload) {
    memoData = rawHex(value);
  } else if (key === "destination_address") {
    memoData = utf8Hex(value.replace(/^0x/, ""));
  } else {
    memoData = utf8Hex(value);
  }
  return { Memo: { MemoType: utf8Hex(key), MemoData: memoData } };
}

function hashEnvelope(e: any): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","bytes32","address","address","uint8","uint256","uint64","uint64","bytes","uint16"],
      [e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version]
    )
  );
}

function encodeSignedIntent(e: any, signature: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version],
      signature]]
  );
}

async function main() {
  const xrplSeed    = requiredEnv("XRPL_SEED");
  const evmRpcUrl   = requiredEnv("XRPL_EVM_RPC_URL");
  const intentKey   = requiredEnv("DEPLOYER_PRIVATE_KEY");
  const adapterAddr = requiredEnv("XRPL_BRIDGE_ADAPTER");
  const market      = requiredEnv("XRPL_STST_MARKET");
  const underlying  = requiredEnv("XRPL_STST_UNDERLYING");
  const repayAmt    = requiredEnv("XRPL_STST_REPAY_AMOUNT");
  const xrplRpc     = optionalEnv("XRPL_RPC_URL", "wss://s.altnet.rippletest.net:51233");
  const gateway     = optionalEnv("XRPL_AXELAR_GATEWAY", "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const destChain   = optionalEnv("XRPL_EVM_AXELAR_CHAIN", "xrpl-evm");
  const currency    = optionalEnv("XRPL_STST_CURRENCY", "5354535400000000000000000000000000000000");
  const issuer      = optionalEnv("XRPL_STST_ISSUER", gateway);
  const addGasDrops = BigInt(optionalEnv("XRPL_ADD_GAS_DROPS", "2000000")); // native-XRP top-up, paid separately
  const confirmSend = process.env.XRPL_CONFIRM_SEND === "true";

  // STST has 18 decimals on XRPL EVM. XRPL IOU value "2" = 2 STST = 2e18 wei.
  const repayAmountEVM = ethers.parseEther(repayAmt);
  // No gas is added to the IOU amount in this flow — gas_fee_amount memo is "0".
  const totalIouValue = repayAmt;

  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const provider   = new ethers.JsonRpcProvider(evmRpcUrl);
  const network    = await provider.getNetwork();
  const adapter    = new ethers.Contract(adapterAddr, ADAPTER_ABI, provider);
  const evmSigner  = new ethers.Wallet(intentKey, provider);

  const xrplAccount  = ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address));
  const nonce        = BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));
  const configSigner = await adapter.intentSignerOfXrplAccount(xrplAccount);

  if (configSigner.toLowerCase() !== evmSigner.address.toLowerCase()) {
    throw new Error(`Signer mismatch: adapter=${configSigner}, local=${evmSigner.address}`);
  }

  const marketConfig = await adapter.marketConfigOf(market);
  if (!marketConfig.listed) throw new Error(`Market not listed: ${market}`);

  const intentId = ethers.keccak256(
    ethers.toUtf8Bytes(`xrpl-stst-repay-addgas:${xrplWallet.address}:${nonce}:${Date.now()}`)
  );

  const envelope = {
    intentId,
    xrplAccount,
    market,
    underlying,
    actionType: 2,         // REPAY
    amount: repayAmountEVM,
    nonce,
    deadline: BigInt(0),
    destinationAddress: "0x",
    version: 1
  };

  const payloadHash = hashEnvelope(envelope);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address","uint256","bytes32"],
      [adapterAddr, network.chainId, payloadHash]
    )
  );
  const signature = await evmSigner.signMessage(ethers.getBytes(digest));
  const payload   = encodeSignedIntent(envelope, signature);

  // Transaction 1: interchain_transfer with gas_fee_amount = "0" (no in-kind gas skim).
  const iouAmount: IssuedCurrencyAmount = {
    currency,
    issuer,
    value: totalIouValue,
  };

  const transferTx: Payment = {
    TransactionType: "Payment",
    Account:     xrplWallet.address,
    Amount:      iouAmount,
    Destination: gateway,
    Memos: [
      buildMemo("type",                "interchain_transfer"),
      buildMemo("destination_address", adapterAddr),
      buildMemo("destination_chain",   destChain),
      buildMemo("gas_fee_amount",      "0"),
      buildMemo("payload",             payload, true),
    ]
  };

  console.log(JSON.stringify({
    dryRun: !confirmSend,
    xrplSender:      xrplWallet.address,
    xrplAccount,
    market,
    underlying,
    repayAmount:     repayAmt,
    gasFeeToken:     "0",
    addGasDrops:     addGasDrops.toString(),
    totalIouSent:    totalIouValue,
    repayAmountEVM:  repayAmountEVM.toString(),
    currency,
    issuer,
    gateway,
    nonce:           nonce.toString(),
    intentId,
    payloadBytes:    payload.length / 2 - 1,
    transferPayment: { ...transferTx, Memos: "[redacted]" },
    addGasPaymentPreview: {
      TransactionType: "Payment",
      Account: xrplWallet.address,
      Amount: addGasDrops.toString(),
      Destination: gateway,
      Memos: "[type=add_gas, msg_id=<transfer tx hash>]"
    }
  }, null, 2));

  if (!confirmSend) {
    console.log("\nSet XRPL_CONFIRM_SEND=true to submit both transactions.");
    return;
  }

  const MAX_FEE_DROPS = 10_000;
  const client = new Client(xrplRpc);
  await client.connect();
  try {
    const prepared = await client.autofill(transferTx);
    const fee = parseInt((prepared as any).Fee ?? "0", 10);
    if (fee > MAX_FEE_DROPS) {
      throw new Error(`Autofill fee ${fee} drops exceeds safety cap of ${MAX_FEE_DROPS} drops`);
    }
    const signed = xrplWallet.sign(prepared);
    console.log("\nSubmitting transfer (gas_fee_amount=0)...");
    const result = await client.submitAndWait(signed.tx_blob);
    const res = (result as any).result;
    console.log(JSON.stringify({ hash: res.hash, result: res.meta?.TransactionResult }, null, 2));
    console.log(`\nXRPL tx:  https://testnet.xrpl.org/transactions/${res.hash}`);
    console.log(`Axelar:   https://testnet.axelarscan.io/gmp/${res.hash.toLowerCase()}`);

    if (res.meta?.TransactionResult !== "tesSUCCESS") {
      throw new Error(`Transfer did not succeed (${res.meta?.TransactionResult}); not submitting Add Gas`);
    }

    const msgId = res.hash.toLowerCase();
    const addGasTx: Payment = {
      TransactionType: "Payment",
      Account: xrplWallet.address,
      Amount: addGasDrops.toString(),
      Destination: gateway,
      Memos: [
        buildMemo("type", "add_gas"),
        buildMemo("msg_id", msgId),
      ]
    };

    console.log(`\nSubmitting Add Gas (${addGasDrops} drops) for msg_id ${msgId}...`);
    const preparedGas = await client.autofill(addGasTx);
    const gasFee = parseInt((preparedGas as any).Fee ?? "0", 10);
    if (gasFee > MAX_FEE_DROPS) {
      throw new Error(`Autofill fee ${gasFee} drops exceeds safety cap of ${MAX_FEE_DROPS} drops`);
    }
    const signedGas = xrplWallet.sign(preparedGas);
    const gasResult = await client.submitAndWait(signedGas.tx_blob);
    const gasRes = (gasResult as any).result;
    console.log(JSON.stringify({ hash: gasRes.hash, result: gasRes.meta?.TransactionResult }, null, 2));
    console.log(`\nAdd Gas tx: https://testnet.xrpl.org/transactions/${gasRes.hash}`);

    console.log("\nWait ~30-60 seconds for the Axelar relayer to execute REPAY on XRPL EVM.");
  } finally {
    await client.disconnect();
  }
}

main().catch(e => { console.error(e.message ?? e); process.exitCode = 1; });
