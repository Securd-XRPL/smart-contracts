import { ethers } from "ethers";
import { Client, Payment, Wallet } from "xrpl";

const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

const ADAPTER_ABI = [
  "function nextNonceByXrplAccount(bytes32 xrplAccount) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32 xrplAccount) view returns (address)",
  "function interchainTokenService() view returns (address)",
  "function marketConfigOf(address market) view returns (address underlying,bytes32 tokenId,bool listed)"
];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function decimalEnv(name: string): bigint {
  const value = requiredEnv(name);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a base-10 integer string`);
  }
  return BigInt(value);
}

function toMemoHex(value: string): string {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  return Buffer.from(clean, "utf8").toString("hex").toUpperCase();
}

function bytesHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2).toUpperCase() : value.toUpperCase();
}

function memo(type: string, data: string) {
  return {
    Memo: {
      MemoType: toMemoHex(type),
      MemoData: type === "payload" ? bytesHex(data) : toMemoHex(data)
    }
  };
}

function encodeSignedIntent(envelope: {
  intentId: string;
  xrplAccount: string;
  market: string;
  underlying: string;
  actionType: number;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  destinationAddress: string;
  version: number;
}, signature: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[
      envelope.intentId,
      envelope.xrplAccount,
      envelope.market,
      envelope.underlying,
      envelope.actionType,
      envelope.amount,
      envelope.nonce,
      envelope.deadline,
      envelope.destinationAddress,
      envelope.version
    ], signature]]
  );
}

function hashEnvelope(envelope: {
  intentId: string;
  xrplAccount: string;
  market: string;
  underlying: string;
  actionType: number;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  destinationAddress: string;
  version: number;
}): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "address", "address", "uint8", "uint256", "uint64", "uint64", "bytes", "uint16"],
    [
      envelope.intentId,
      envelope.xrplAccount,
      envelope.market,
      envelope.underlying,
      envelope.actionType,
      envelope.amount,
      envelope.nonce,
      envelope.deadline,
      envelope.destinationAddress,
      envelope.version
    ]
  );
  return ethers.keccak256(encoded);
}

async function main() {
  const xrplRpcUrl = optionalEnv("XRPL_RPC_URL", "wss://s.altnet.rippletest.net:51233");
  const xrplSeed = requiredEnv("XRPL_SEED");
  const xrplGateway = optionalEnv("XRPL_AXELAR_GATEWAY", "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const destinationChain = optionalEnv("XRPL_EVM_AXELAR_CHAIN", "xrpl-evm");
  const destinationAddress = requiredEnv("XRPL_DEPOSIT_DESTINATION_ADDRESS");
  const evmRpcUrl = requiredEnv("XRPL_EVM_RPC_URL");
  const adapterAddress = requiredEnv("XRPL_BRIDGE_ADAPTER");
  const market = requiredEnv("XRPL_DEPOSIT_MARKET");
  const underlying = requiredEnv("XRPL_DEPOSIT_UNDERLYING");
  const intentSignerPrivateKey = process.env.INTENT_SIGNER_PRIVATE_KEY?.trim()
    || process.env.DEPLOYER_PRIVATE_KEY?.trim()
    || "";
  if (!intentSignerPrivateKey) {
    throw new Error("Missing INTENT_SIGNER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY");
  }

  const depositAmountDrops = decimalEnv("XRPL_DEPOSIT_AMOUNT_DROPS");
  const gasFeeDrops = BigInt(optionalEnv("XRPL_DEPOSIT_GAS_FEE_DROPS", "0"));
  const totalPaymentDrops = depositAmountDrops + gasFeeDrops;
  // XRPL drops have 6 decimals; native XRP on XRPL EVM has 18 decimals.
  // The Axelar ITS scales the amount by 10^12 when delivering to XRPL EVM.
  // The intent envelope must store the EVM-scaled amount to match what the ITS passes.
  const DROPS_TO_EVM_SCALE = BigInt(10 ** 12);
  const depositAmountEVM = depositAmountDrops * DROPS_TO_EVM_SCALE;
  const deadline = BigInt(optionalEnv("XRPL_DEPOSIT_DEADLINE", "0"));
  const payloadDestinationAddress = optionalEnv("XRPL_DEPOSIT_INTENT_DESTINATION_BYTES", "0x");
  const liveIts = optionalEnv("INTERCHAIN_TOKEN_SERVICE", "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C");
  const confirmSend = process.env.XRPL_CONFIRM_SEND === "true";

  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const provider = new ethers.JsonRpcProvider(evmRpcUrl);
  const network = await provider.getNetwork();
  const adapter = new ethers.Contract(adapterAddress, ADAPTER_ABI, provider);
  const evmSigner = new ethers.Wallet(intentSignerPrivateKey, provider);
  const xrplAccount = process.env.XRPL_ACCOUNT_BYTES32?.trim()
    || ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address));
  const nonce = process.env.XRPL_DEPOSIT_NONCE
    ? BigInt(process.env.XRPL_DEPOSIT_NONCE)
    : BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));
  const intentId = process.env.XRPL_INTENT_ID?.trim()
    || ethers.keccak256(ethers.toUtf8Bytes(`xrpl-deposit:${xrplWallet.address}:${nonce.toString()}:${Date.now().toString()}`));

  const configuredSigner = await adapter.intentSignerOfXrplAccount(xrplAccount);
  if (configuredSigner.toLowerCase() !== evmSigner.address.toLowerCase()) {
    throw new Error(
      `Adapter signer mismatch for ${xrplAccount}: expected ${configuredSigner}, local signer is ${evmSigner.address}`
    );
  }

  const configuredIts = await adapter.interchainTokenService();
  if (configuredIts.toLowerCase() !== liveIts.toLowerCase()) {
    throw new Error(`Adapter ITS mismatch: expected ${liveIts}, deployed adapter has ${configuredIts}`);
  }

  const marketConfig = await adapter.marketConfigOf(market);
  if (!marketConfig.listed) {
    throw new Error(`Adapter market is not listed: ${market}`);
  }
  if (marketConfig.underlying.toLowerCase() !== underlying.toLowerCase()) {
    throw new Error(`Market underlying mismatch: expected ${underlying}, adapter has ${marketConfig.underlying}`);
  }

  const envelope = {
    intentId,
    xrplAccount,
    market,
    underlying,
    actionType: 0,
    amount: depositAmountEVM,
    nonce,
    deadline,
    destinationAddress: payloadDestinationAddress,
    version: 1
  };

  const payloadHash = hashEnvelope(envelope);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "bytes32"], [adapterAddress, network.chainId, payloadHash])
  );
  const signature = await evmSigner.signMessage(ethers.getBytes(digest));
  const payload = encodeSignedIntent(envelope, signature);

  const tx: Payment = {
    TransactionType: "Payment",
    Account: xrplWallet.address,
    Amount: totalPaymentDrops.toString(),
    Destination: xrplGateway,
    Memos: [
      memo("type", "interchain_transfer"),
      memo("destination_address", destinationAddress),
      memo("destination_chain", destinationChain),
      memo("gas_fee_amount", gasFeeDrops.toString()),
      memo("payload", payload)
    ]
  };

  console.log(JSON.stringify({
    dryRun: !confirmSend,
    xrplRpcUrl,
    xrplAccount: xrplWallet.address,
    xrplAccountBytes32: xrplAccount,
    xrplGateway,
    destinationChain,
    destinationAddress,
    adapterAddress,
    market,
    underlying,
    depositAmountDrops: depositAmountDrops.toString(),
    depositAmountEVM: depositAmountEVM.toString(),
    gasFeeDrops: gasFeeDrops.toString(),
    totalPaymentDrops: totalPaymentDrops.toString(),
    nonce: nonce.toString(),
    intentId,
    payloadBytes: payload.length / 2 - 1,  // log byte length only; payload contains the signed intent
    payment: { ...tx, Memos: "[redacted]" }
  }, null, 2));

  if (!confirmSend) {
    console.log("Set XRPL_CONFIRM_SEND=true to submit this XRPL testnet Payment.");
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
    const signed = xrplWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
