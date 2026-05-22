/**
 * End-to-end STST lending flow from XRPL Ledger → XRPL EVM via Axelar.
 *
 * Executes the same 6-action sequence used for XRP but with the sSTST market:
 *   1. SUPPLY      10 STST  (ITS interchain_transfer with IOU Amount)
 *   2. ENTER_MARKET        (GMP call_contract)
 *   3. BORROW       1 STST (GMP call_contract — adapter sends STST back to XRPL)
 *   4. REPAY        2 STST (ITS interchain_transfer with IOU Amount)
 *   5. EXIT_MARKET         (GMP call_contract)
 *   6. WITHDRAW     5 STST (GMP call_contract — adapter sends STST back to XRPL)
 *
 * After each XRPL transaction this script polls the adapter nonce to confirm
 * the Axelar relayer executed the intent on XRPL EVM before proceeding.
 *
 * Gas for ITS steps (SUPPLY, REPAY): taken from the IOU token itself.
 * Total IOU sent = amount + gasFeeToken; gas_fee_amount memo = gasFeeToken.
 *
 * Prerequisites:
 *   - executeSetCollateralFactor.ts must have been run (sSTST CF = 70%)
 *   - XRPL Ledger address has ≥14 STST (10 supply + 2 gas + 2 repay (covers interest via gas))
 *   - XRPL Ledger address has ≥15 XRP for GMP gas (5 × 3 XRP)
 *
 * Required env vars:
 *   XRPL_SEED, XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY,
 *   XRPL_BRIDGE_ADAPTER, XRPL_STST_MARKET, XRPL_STST_UNDERLYING
 *
 * Optional:
 *   XRPL_RPC_URL             default: wss://s.altnet.rippletest.net:51233
 *   XRPL_AXELAR_GATEWAY      default: rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
 *   XRPL_EVM_AXELAR_CHAIN    default: xrpl-evm
 *   XRPL_GMP_GAS_DROPS       default: 3000000
 *   XRPL_STST_GAS_FEE        Gas fee per ITS tx in STST IOU units (default: "2")
 *   XRPL_RELAY_TIMEOUT_SEC   seconds to wait for relay (default: 120)
 *   XRPL_START_FROM_STEP     skip steps before this number, 1-6 (default: 1)
 *   XRPL_CONFIRM_SEND        Set to "true" to submit (dry run otherwise)
 */
import { ethers } from "ethers";
import { Client, Payment, IssuedCurrencyAmount, Wallet } from "xrpl";

const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

const ADAPTER_ABI = [
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
  "function marketConfigOf(address) view returns (address underlying, bytes32 tokenId, bool listed)",
  "function egressGasValue() view returns (uint256)",
];
const CTOKEN_ABI = [
  "function balanceOfUnderlying(address) returns (uint256)",
  "function borrowBalanceCurrent(address) returns (uint256)",
];
const PROXY_FACTORY_ABI = [
  "function getProxy(bytes32 xrplAccount) view returns (address proxy, bool exists)",
];

// ── helpers ───────────────────────────────────────────────────────────────────

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function utf8Hex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex").toUpperCase();
}

function rawHex(s: string): string {
  return (s.startsWith("0x") ? s.slice(2) : s).toUpperCase();
}

function memo(key: string, value: string, isPayload = false) {
  const data = isPayload
    ? rawHex(value)
    : key === "destination_address"
      ? utf8Hex(value.replace(/^0x/, ""))
      : utf8Hex(value);
  return { Memo: { MemoType: utf8Hex(key), MemoData: data } };
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

function encodeSignedIntent(e: any, sig: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version], sig]]
  );
}

async function buildAndSignEnvelope(
  evmSigner: ethers.Wallet,
  adapterAddr: string,
  chainId: bigint,
  envelope: any
): Promise<string> {
  const payloadHash = hashEnvelope(envelope);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address","uint256","bytes32"],
      [adapterAddr, chainId, payloadHash]
    )
  );
  const sig = await evmSigner.signMessage(ethers.getBytes(digest));
  return encodeSignedIntent(envelope, sig);
}

async function pollNonce(
  adapter: ethers.Contract,
  xrplAccount: string,
  expectedNonce: bigint,
  timeoutSec: number
): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  process.stdout.write("  Waiting for relay");
  while (Date.now() < deadline) {
    const n = BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));
    if (n >= expectedNonce) { process.stdout.write(" ✓\n"); return; }
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 5000));
  }
  process.stdout.write(" TIMEOUT\n");
  throw new Error(`Relay not confirmed within ${timeoutSec}s (expected nonce ${expectedNonce})`);
}

async function submitXrpl(client: Client, wallet: Wallet, tx: Payment): Promise<string> {
  const MAX_FEE_DROPS = 10_000;
  const prepared = await client.autofill(tx);
  const fee = parseInt((prepared as any).Fee ?? "0", 10);
  if (fee > MAX_FEE_DROPS) throw new Error(`Fee ${fee} drops exceeds cap`);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const res = (result as any).result;
  if (res.meta?.TransactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL tx failed: ${res.meta?.TransactionResult}`);
  }
  return res.hash as string;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const xrplSeed    = req("XRPL_SEED");
  const evmRpcUrl   = req("XRPL_EVM_RPC_URL");
  const intentKey   = req("DEPLOYER_PRIVATE_KEY");
  const adapterAddr = req("XRPL_BRIDGE_ADAPTER");
  const market      = req("XRPL_STST_MARKET");
  const underlying  = req("XRPL_STST_UNDERLYING");
  const xrplRpc     = opt("XRPL_RPC_URL", "wss://s.altnet.rippletest.net:51233");
  const gateway     = opt("XRPL_AXELAR_GATEWAY", "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const destChain   = opt("XRPL_EVM_AXELAR_CHAIN", "xrpl-evm");
  const gasDrops     = BigInt(opt("XRPL_GMP_GAS_DROPS", "3000000"));  // 3 XRP per GMP call
  const gasFeeToken  = opt("XRPL_STST_GAS_FEE", "2");               // gas taken in STST per ITS tx
  const timeoutSec   = parseInt(opt("XRPL_RELAY_TIMEOUT_SEC", "120"), 10);
  const startFromStep = parseInt(opt("XRPL_START_FROM_STEP", "1"), 10);
  const confirmSend  = process.env.XRPL_CONFIRM_SEND === "true";
  const currency    = opt("XRPL_STST_CURRENCY", "5354535400000000000000000000000000000000");
  const issuer      = opt("XRPL_STST_ISSUER", gateway);

  const SUPPLY_AMOUNT   = "10";   // 10 STST (net supply; total IOU = 10 + gasFeeToken)
  const BORROW_AMOUNT   = "1";    // 1 STST
  const REPAY_AMOUNT    = "1";    // 1 STST — must not exceed borrow balance (Compound reverts on over-repay)
  const WITHDRAW_AMOUNT = "5";    // 5 STST

  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const provider   = new ethers.JsonRpcProvider(evmRpcUrl);
  const network    = await provider.getNetwork();
  const adapter    = new ethers.Contract(adapterAddr, ADAPTER_ABI, provider);
  const evmSigner  = new ethers.Wallet(intentKey, provider);
  const cstst      = new ethers.Contract(market, CTOKEN_ABI, provider);

  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address));

  // Pre-flight checks
  const configSigner = await adapter.intentSignerOfXrplAccount(xrplAccount);
  if (configSigner.toLowerCase() !== evmSigner.address.toLowerCase()) {
    throw new Error(`Signer mismatch: adapter=${configSigner}, local=${evmSigner.address}`);
  }
  const mktConfig = await adapter.marketConfigOf(market);
  if (!mktConfig.listed) throw new Error(`sSTST market not listed in adapter`);

  const egressGasValue = await adapter.egressGasValue();
  console.log("Signer:          ", xrplWallet.address);
  console.log("cSTST market:    ", market);
  console.log("Underlying:      ", underlying);
  console.log("Egress gas value:", ethers.formatEther(egressGasValue), "XRP");
  console.log("Confirm send:    ", confirmSend);
  if (!confirmSend) {
    console.log("\nDRY RUN — set XRPL_CONFIRM_SEND=true to execute.\n");
  }

  const client = new Client(xrplRpc);
  if (confirmSend) await client.connect();

  const hashes: Record<string, string> = {};

  try {
    // helper to get fresh nonce each time
    const getNonce = async () => BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));

    // ── 1. SUPPLY 10 STST ──────────────────────────────────────────────────
    if (startFromStep <= 1) {
      console.log("\n═══ 1. SUPPLY 10 STST (ITS interchain_transfer) ═══");
      const nonce = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `stst-supply:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: 0, amount: ethers.parseEther(SUPPLY_AMOUNT),
        nonce, deadline: BigInt(0), destinationAddress: "0x", version: 1
      };
      const payload = await buildAndSignEnvelope(evmSigner, adapterAddr, network.chainId, envelope);
      const supplyTotal = (parseFloat(SUPPLY_AMOUNT) + parseFloat(gasFeeToken)).toString();
      const tx: Payment = {
        TransactionType: "Payment",
        Account: xrplWallet.address,
        Amount: { currency, issuer, value: supplyTotal } as IssuedCurrencyAmount,
        Destination: gateway,
        Memos: [
          memo("type", "interchain_transfer"),
          memo("destination_address", adapterAddr),
          memo("destination_chain", destChain),
          memo("gas_fee_amount", gasFeeToken),
          memo("payload", payload, true),
        ]
      };
      if (!confirmSend) { console.log("  [dry run] SUPPLY payload built OK"); }
      else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["1_SUPPLY"] = hash;
        console.log(`  XRPL TX: https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar:  https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
      }
    } else { console.log("\n═══ 1. SUPPLY — skipped (startFromStep=${startFromStep}) ═══"); }

    // ── 2. ENTER_MARKET ────────────────────────────────────────────────────
    if (startFromStep <= 2) {
      console.log("\n═══ 2. ENTER_MARKET ═══");
      const nonce = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `stst-enter:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: 4, amount: BigInt(0),
        nonce, deadline: BigInt(0), destinationAddress: "0x", version: 1
      };
      const payload = await buildAndSignEnvelope(evmSigner, adapterAddr, network.chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account: xrplWallet.address,
        Amount: gasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type", "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain", destChain),
          memo("payload", payload, true),
        ]
      };
      if (!confirmSend) { console.log("  [dry run] ENTER_MARKET payload built OK"); }
      else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["2_ENTER_MARKET"] = hash;
        console.log(`  XRPL TX: https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar:  https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
      }
    } else { console.log("\n═══ 2. ENTER_MARKET — skipped ═══"); }

    // ── 3. BORROW 1 STST ───────────────────────────────────────────────────
    if (startFromStep <= 3) {
      console.log("\n═══ 3. BORROW 1 STST (GMP — adapter egresses STST back to XRPL) ═══");
      const nonce = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `stst-borrow:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const destBytes = ethers.hexlify(ethers.toUtf8Bytes(xrplWallet.address));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: 1, amount: ethers.parseEther(BORROW_AMOUNT),
        nonce, deadline: BigInt(0), destinationAddress: destBytes, version: 1
      };
      const payload = await buildAndSignEnvelope(evmSigner, adapterAddr, network.chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account: xrplWallet.address,
        Amount: gasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type", "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain", destChain),
          memo("payload", payload, true),
        ]
      };
      if (!confirmSend) { console.log("  [dry run] BORROW payload built OK"); }
      else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["3_BORROW"] = hash;
        console.log(`  XRPL TX: https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar:  https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
        const proxyForBorrow = "0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86";
        const borrowBal = await cstst.borrowBalanceCurrent.staticCall(proxyForBorrow);
        console.log("  Borrow balance on EVM (proxy):", ethers.formatEther(borrowBal), "STST");
      }
    } else { console.log("\n═══ 3. BORROW — skipped ═══"); }

    // ── 4. REPAY 2 STST ────────────────────────────────────────────────────
    if (startFromStep <= 4) {
      console.log("\n═══ 4. REPAY 2 STST (ITS interchain_transfer) ═══");
      const nonce = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `stst-repay:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: 2, amount: ethers.parseEther(REPAY_AMOUNT),
        nonce, deadline: BigInt(0), destinationAddress: "0x", version: 1
      };
      const payload = await buildAndSignEnvelope(evmSigner, adapterAddr, network.chainId, envelope);
      const repayTotal = (parseFloat(REPAY_AMOUNT) + parseFloat(gasFeeToken)).toString();
      const tx: Payment = {
        TransactionType: "Payment",
        Account: xrplWallet.address,
        Amount: { currency, issuer, value: repayTotal } as IssuedCurrencyAmount,
        Destination: gateway,
        Memos: [
          memo("type", "interchain_transfer"),
          memo("destination_address", adapterAddr),
          memo("destination_chain", destChain),
          memo("gas_fee_amount", gasFeeToken),
          memo("payload", payload, true),
        ]
      };
      if (!confirmSend) { console.log("  [dry run] REPAY payload built OK"); }
      else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["4_REPAY"] = hash;
        console.log(`  XRPL TX: https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar:  https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
      }
    } else { console.log("\n═══ 4. REPAY — skipped ═══"); }

    // ── 5. EXIT_MARKET ─────────────────────────────────────────────────────
    if (startFromStep <= 5) {
      console.log("\n═══ 5. EXIT_MARKET ═══");
      const nonce = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `stst-exit:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: 5, amount: BigInt(0),
        nonce, deadline: BigInt(0), destinationAddress: "0x", version: 1
      };
      const payload = await buildAndSignEnvelope(evmSigner, adapterAddr, network.chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account: xrplWallet.address,
        Amount: gasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type", "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain", destChain),
          memo("payload", payload, true),
        ]
      };
      if (!confirmSend) { console.log("  [dry run] EXIT_MARKET payload built OK"); }
      else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["5_EXIT_MARKET"] = hash;
        console.log(`  XRPL TX: https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar:  https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
      }
    } else { console.log("\n═══ 5. EXIT_MARKET — skipped ═══"); }

    // ── 6. WITHDRAW 5 STST ─────────────────────────────────────────────────
    if (startFromStep <= 6) {
      console.log("\n═══ 6. WITHDRAW 5 STST (GMP — adapter egresses STST back to XRPL) ═══");
      const nonce = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `stst-withdraw:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const destBytes = ethers.hexlify(ethers.toUtf8Bytes(xrplWallet.address));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: 3, amount: ethers.parseEther(WITHDRAW_AMOUNT),
        nonce, deadline: BigInt(0), destinationAddress: destBytes, version: 1
      };
      const payload = await buildAndSignEnvelope(evmSigner, adapterAddr, network.chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account: xrplWallet.address,
        Amount: gasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type", "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain", destChain),
          memo("payload", payload, true),
        ]
      };
      if (!confirmSend) { console.log("  [dry run] WITHDRAW payload built OK"); }
      else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["6_WITHDRAW"] = hash;
        console.log(`  XRPL TX: https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar:  https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
      }
    } else { console.log("\n═══ 6. WITHDRAW — skipped ═══"); }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log("\n═══ Summary ═══");
    if (confirmSend) {
      for (const [step, hash] of Object.entries(hashes)) {
        console.log(`${step}: https://testnet.xrpl.org/transactions/${hash}`);
      }
      const proxyAddr = "0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86";
      const supplied  = await cstst.balanceOfUnderlying.staticCall(proxyAddr);
      const borrowed  = await cstst.borrowBalanceCurrent.staticCall(proxyAddr);
      console.log("\nFinal EVM state:");
      console.log("  Supplied:", ethers.formatEther(supplied), "STST");
      console.log("  Borrowed:", ethers.formatEther(borrowed), "STST");
    } else {
      console.log("Dry run complete — all 6 payloads built successfully.");
      console.log("Set XRPL_CONFIRM_SEND=true to execute.");
    }

  } finally {
    if (confirmSend) await client.disconnect();
  }
}

main().catch(e => { console.error(e.message ?? e); process.exitCode = 1; });
