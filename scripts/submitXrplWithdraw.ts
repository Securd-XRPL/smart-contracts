/**
 * Sends a WITHDRAW intent from XRPL Ledger to XRPL EVM via Axelar GMP (call_contract).
 *
 * The XRPL Payment carries:
 *   - XRP for Axelar gas only (no token transfer on inbound)
 *   - A signed IntentEnvelope (actionType=WITHDRAW) as the payload
 *
 * On XRPL EVM the adapter:
 *   1. Validates the gateway approval and intent signature
 *   2. Calls proxy.redeemUnderlying(amount) on the user's cToken position
 *   3. Pulls the redeemed XRP back to the adapter
 *   4. Sends it back to the XRPL account via ITS interchainTransfer
 *
 * Required env vars:
 *   XRPL_SEED                    Funded XRPL testnet seed
 *   XRPL_EVM_RPC_URL             XRPL EVM RPC endpoint
 *   DEPLOYER_PRIVATE_KEY         Intent signer private key
 *   XRPL_BRIDGE_ADAPTER          XRPLSecurdBridgeAdapter address on XRPL EVM
 *   XRPL_DEPOSIT_MARKET          sXRP cToken market address
 *   XRPL_DEPOSIT_UNDERLYING      Underlying token address (0xEeee... for XRP)
 *   XRPL_WITHDRAW_AMOUNT_XRP     Amount of XRP to withdraw (human-readable, e.g. "2")
 *
 * Optional env vars:
 *   XRPL_RPC_URL                 default: wss://s.altnet.rippletest.net:51233
 *   XRPL_AXELAR_GATEWAY          default: rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
 *   XRPL_EVM_AXELAR_CHAIN        default: xrpl-evm
 *   XRPL_GMP_GAS_DROPS           GMP gas drops for inbound relay (default: 3000000)
 *   XRPL_CONFIRM_SEND            Set to "true" to actually submit
 */
import { ethers } from "ethers";
import { Client, Payment, Wallet } from "xrpl";

const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

const ADAPTER_ABI = [
  "function nextNonceByXrplAccount(bytes32 xrplAccount) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32 xrplAccount) view returns (address)",
  "function marketConfigOf(address market) view returns (address underlying, bytes32 tokenId, bool listed)",
  "function egressGasValue() view returns (uint256)"
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

function hashEnvelope(envelope: {
  intentId: string; xrplAccount: string; market: string; underlying: string;
  actionType: number; amount: bigint; nonce: bigint; deadline: bigint;
  destinationAddress: string; version: number;
}): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32","bytes32","address","address","uint8","uint256","uint64","uint64","bytes","uint16"],
    [envelope.intentId, envelope.xrplAccount, envelope.market, envelope.underlying,
     envelope.actionType, envelope.amount, envelope.nonce, envelope.deadline,
     envelope.destinationAddress, envelope.version]
  ));
}

function encodeSignedIntent(envelope: {
  intentId: string; xrplAccount: string; market: string; underlying: string;
  actionType: number; amount: bigint; nonce: bigint; deadline: bigint;
  destinationAddress: string; version: number;
}, signature: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[
      envelope.intentId, envelope.xrplAccount, envelope.market, envelope.underlying,
      envelope.actionType, envelope.amount, envelope.nonce, envelope.deadline,
      envelope.destinationAddress, envelope.version
    ], signature]]
  );
}

async function main() {
  const xrplRpcUrl   = optionalEnv("XRPL_RPC_URL", "wss://s.altnet.rippletest.net:51233");
  const xrplSeed     = requiredEnv("XRPL_SEED");
  const xrplGateway  = optionalEnv("XRPL_AXELAR_GATEWAY", "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const destChain    = optionalEnv("XRPL_EVM_AXELAR_CHAIN", "xrpl-evm");
  const evmRpcUrl    = requiredEnv("XRPL_EVM_RPC_URL");
  const adapterAddr  = requiredEnv("XRPL_BRIDGE_ADAPTER");
  const market       = requiredEnv("XRPL_DEPOSIT_MARKET");
  const underlying   = requiredEnv("XRPL_DEPOSIT_UNDERLYING");
  const gmpGasDrops  = BigInt(optionalEnv("XRPL_GMP_GAS_DROPS", "3000000"));
  const confirmSend  = process.env.XRPL_CONFIRM_SEND === "true";

  const intentSignerKey = process.env.INTENT_SIGNER_PRIVATE_KEY?.trim()
    || process.env.DEPLOYER_PRIVATE_KEY?.trim() || "";
  if (!intentSignerKey) throw new Error("Missing INTENT_SIGNER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY");

  // Amount to withdraw — input as human-readable XRP, converted to 18-decimal EVM wei.
  // The adapter's redeemUnderlying and the ITS egress both use 18-decimal amounts on XRPL EVM.
  const withdrawXRP   = requiredEnv("XRPL_WITHDRAW_AMOUNT_XRP");
  const withdrawAmountEVM = ethers.parseEther(withdrawXRP); // XRP → 18-decimal wei

  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const provider   = new ethers.JsonRpcProvider(evmRpcUrl);
  const network    = await provider.getNetwork();
  const evmSigner  = new ethers.Wallet(intentSignerKey, provider);
  const adapter    = new ethers.Contract(adapterAddr, ADAPTER_ABI, provider);

  const xrplAccount = process.env.XRPL_ACCOUNT_BYTES32?.trim()
    || ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address));

  const nonce = process.env.XRPL_WITHDRAW_NONCE
    ? BigInt(process.env.XRPL_WITHDRAW_NONCE)
    : BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));

  // Verify signer is configured
  const configuredSigner = await adapter.intentSignerOfXrplAccount(xrplAccount);
  if (configuredSigner.toLowerCase() !== evmSigner.address.toLowerCase()) {
    throw new Error(
      `Signer mismatch for ${xrplAccount}: adapter has ${configuredSigner}, local key is ${evmSigner.address}`
    );
  }

  // Verify market is listed
  const marketConfig = await adapter.marketConfigOf(market);
  if (!marketConfig.listed) throw new Error(`Market not listed: ${market}`);
  if (marketConfig.underlying.toLowerCase() !== underlying.toLowerCase()) {
    throw new Error(`underlying mismatch: expected ${underlying}, adapter has ${marketConfig.underlying}`);
  }

  const egressGasValue = await adapter.egressGasValue();
  console.log("egressGasValue:", ethers.formatEther(egressGasValue), "XRP");

  const intentId = process.env.XRPL_INTENT_ID?.trim()
    || ethers.keccak256(ethers.toUtf8Bytes(
      `xrpl-withdraw:${xrplWallet.address}:${nonce.toString()}:${Date.now()}`
    ));

  // destinationAddress = where to send the withdrawn XRP on XRPL Ledger.
  // ITS expects this as raw bytes. For XRPL, encode the r-address as UTF-8 bytes.
  const destinationXrplAddress = process.env.XRPL_WITHDRAW_DESTINATION || xrplWallet.address;
  const destinationAddressBytes = ethers.hexlify(ethers.toUtf8Bytes(destinationXrplAddress));

  const envelope = {
    intentId,
    xrplAccount,
    market,
    underlying,
    actionType: 3,              // WITHDRAW = 3
    amount: withdrawAmountEVM,  // 18-decimal EVM wei
    nonce,
    deadline: BigInt(0),
    destinationAddress: destinationAddressBytes,
    version: 1
  };

  const payloadHash = hashEnvelope(envelope);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32"],
      [adapterAddr, network.chainId, payloadHash]
    )
  );
  const signature = await evmSigner.signMessage(ethers.getBytes(digest));
  const payload   = encodeSignedIntent(envelope, signature);

  // XRPL Payment: GMP call_contract — only gas XRP, no token transfer.
  const tx: Payment = {
    TransactionType: "Payment",
    Account:     xrplWallet.address,
    Amount:      gmpGasDrops.toString(),
    Destination: xrplGateway,
    Memos: [
      buildMemo("type",                "call_contract"),
      buildMemo("destination_address", adapterAddr),
      buildMemo("destination_chain",   destChain),
      buildMemo("payload",             payload, true)
    ]
  };

  const summary = {
    dryRun: !confirmSend,
    xrplRpcUrl,
    xrplSender:           xrplWallet.address,
    xrplAccountBytes32:   xrplAccount,
    xrplGateway,
    destinationChain:     destChain,
    adapterAddress:       adapterAddr,
    market,
    underlying,
    withdrawAmountXRP:    withdrawXRP,
    withdrawAmountEVM:    withdrawAmountEVM.toString(),
    returnDestination:    destinationXrplAddress,
    gmpGasDrops:          gmpGasDrops.toString(),
    nonce:                nonce.toString(),
    intentId,
    egressGasValue:       egressGasValue.toString(),
    payloadBytes:         payload.length / 2 - 1, // log byte length only; payload contains the signed intent
    payment:              { ...tx, Memos: "[redacted]" }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!confirmSend) {
    console.log("\nSet XRPL_CONFIRM_SEND=true to submit.");
    return;
  }

  const MAX_FEE_DROPS = 10_000;
  const client = new Client(xrplRpcUrl);
  await client.connect();
  try {
    const prepared = await client.autofill(tx);
    const fee = parseInt((prepared as any).Fee ?? "0", 10);
    if (fee > MAX_FEE_DROPS) {
      throw new Error(`Autofill fee ${fee} drops exceeds safety cap of ${MAX_FEE_DROPS} drops`);
    }
    const signed   = xrplWallet.sign(prepared);
    console.log("\nSubmitting...");
    const result = await client.submitAndWait(signed.tx_blob);
    console.log("\nResult:", JSON.stringify(result, null, 2));
    const hash = (result as any).result?.hash;
    if (hash) {
      console.log(`\nXRPL tx:  https://testnet.xrpl.org/transactions/${hash}`);
      console.log(`Axelar:   https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
    }
    console.log("\nWait ~30-60 seconds for the Axelar relayer to execute the withdraw on XRPL EVM.");
    console.log("Check adapter nonce (should advance by 1) and your XRPL wallet for the returned XRP.");
  } finally {
    await client.disconnect();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
