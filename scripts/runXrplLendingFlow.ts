/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Securd — End-to-End XRP Lending Flow  (XRPL Ledger → XRPL EVM via Axelar)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS SCRIPT DOES
 * ─────────────────────
 * Executes all 6 lending actions in order, each as an XRPL Payment transaction
 * routed through the Axelar bridge to the XRPLSecurdBridgeAdapter on XRPL EVM:
 *
 *   1. SUPPLY       10 XRP   ITS interchain_transfer  (tokens flow XRPL → EVM)
 *   2. ENTER_MARKET          GMP call_contract         (instruction only)
 *   3. BORROW        1 XRP   GMP call_contract         (tokens flow EVM → XRPL)
 *   4. REPAY         all     ITS interchain_transfer   (tokens flow XRPL → EVM)
 *   5. EXIT_MARKET           GMP call_contract         (instruction only)
 *   6. WITHDRAW     10 XRP   GMP call_contract         (tokens flow EVM → XRPL)
 *
 * HOW AN ACTION IS EXECUTED (overview)
 * ─────────────────────────────────────
 *   a) Build an "intent envelope" — a struct that describes exactly what the
 *      adapter should do: which market, which action, how much, for whom.
 *
 *   b) Sign the envelope with the SESSION KEY (an EVM private key registered
 *      on-chain for this XRPL user via setIntentSigner). The adapter verifies
 *      this signature before executing anything.
 *
 *   c) ABI-encode the signed envelope as the "payload" carried inside the XRPL
 *      Payment memo. The Axelar relayer forwards this payload to the adapter.
 *
 *   d) Submit the Payment to the Axelar gateway address on XRPL. The relayer
 *      picks it up and calls either:
 *        • executeWithInterchainToken()  for SUPPLY / REPAY  (ITS path)
 *        • execute()                     for all other steps  (GMP path)
 *
 * THE TWO TRANSPORT MODES
 * ───────────────────────
 *   ITS (Interchain Token Service) — used when tokens travel XRPL → EVM
 *     • XRPL memo type  : "interchain_transfer"
 *     • Amount field    : XRP drops to bridge (becomes wei on EVM × 10^12)
 *     • gas_fee_amount  : "0" for native XRP (gas taken separately for ERC-20)
 *
 *   GMP (General Message Passing) — used for instruction-only or EVM → XRPL
 *     • XRPL memo type  : "call_contract"
 *     • Amount field    : gas fee in drops (covers Axelar relay cost)
 *     • No tokens are moved from XRPL; the adapter handles outbound XRP itself
 *
 * THE SESSION KEY (intent signer)
 * ────────────────────────────────
 *   The session key is an EVM private key.  Its corresponding address must be
 *   registered in the adapter via:
 *
 *     adapter.setIntentSigner(keccak256(utf8(xrplAddress)), sessionKeyAddress)
 *
 *   This is done ONCE per user (or per session if you rotate keys).  The adapter
 *   stores the mapping xrplAccountHash → signerAddress and verifies every intent
 *   signature against it.  The script checks this on start-up and registers
 *   automatically if not yet set (requires DEPLOYER_PRIVATE_KEY to be the admin).
 *
 * THE INTENT ENVELOPE
 * ────────────────────
 *   struct IntentEnvelope {
 *     bytes32  intentId;           // unique random ID (prevents replay across chains)
 *     bytes32  xrplAccount;        // keccak256(utf8(xrplAddress))
 *     address  market;             // cToken address  (e.g. sXRP = 0x6ec503...)
 *     address  underlying;         // underlying token (0xEeee...EeE for native XRP)
 *     uint8    actionType;         // 0=SUPPLY 1=BORROW 2=REPAY 3=WITHDRAW 4=ENTER 5=EXIT
 *     uint256  amount;             // 18-decimal EVM amount (drops × 10^12 for XRP)
 *     uint64   nonce;              // monotonically increasing, per xrplAccount
 *     uint64   deadline;           // 0 = no expiry
 *     bytes    destinationAddress; // utf8(xrplAddress) for BORROW/WITHDRAW, else "0x"
 *     uint16   version;            // always 1
 *   }
 *
 * SIGNING SCHEME
 * ──────────────
 *   payloadHash = keccak256(abi.encode(envelope fields...))
 *   digest      = keccak256(abi.encode(adapterAddress, chainId, payloadHash))
 *   signature   = ECDSA.sign(sessionKey, digest)
 *
 *   The domain binding (adapterAddress + chainId) prevents signatures valid on
 *   one deployment from being replayed on another.
 *
 * NONCE SAFETY
 * ────────────
 *   The adapter stores nextNonceByXrplAccount[xrplAccount].  Each executed intent
 *   increments it.  The script reads the nonce fresh before each step to avoid
 *   submitting a stale nonce.  After submitting the XRPL TX, it polls the adapter
 *   until the nonce advances — confirming Axelar relayed and the adapter executed.
 *
 *   Important: the nonce advance confirms *some* intent executed, not necessarily
 *   yours.  In production, verify the IntentExecuted event matches your intentId.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Required env vars:
 *   XRPL_SEED               XRPL wallet seed (family seed format, sXXX...)
 *   XRPL_EVM_RPC_URL        XRPL EVM JSON-RPC endpoint
 *   DEPLOYER_PRIVATE_KEY    EVM private key — used as session key AND adapter admin
 *   XRPL_BRIDGE_ADAPTER     XRPLSecurdBridgeAdapter contract address
 *   XRPL_DEPOSIT_MARKET     sXRP cToken address
 *   XRPL_DEPOSIT_UNDERLYING underlying address (0xEeee...EeE for native XRP)
 *
 * Optional env vars:
 *   XRPL_RPC_URL             default: wss://s.altnet.rippletest.net:51233
 *   XRPL_AXELAR_GATEWAY      default: rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2
 *   XRPL_EVM_AXELAR_CHAIN    default: xrpl-evm
 *   XRPL_GMP_GAS_DROPS       GMP relay gas in drops  (default: 3 000 000 = 3 XRP)
 *   XRPL_REPAY_GAS_FEE_DROPS ITS relay gas for REPAY (default: 2 000 000 = 2 XRP)
 *   XRPL_RELAY_TIMEOUT_SEC   seconds to wait for each relay confirmation (default: 120)
 *   XRPL_START_FROM_STEP     resume from step N (1-6), skips earlier steps (default: 1)
 *   XRPL_CONFIRM_SEND        set to "true" to submit live transactions (default: dry-run)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { ethers } from "ethers";
import { Client, Payment, Wallet } from "xrpl";

// ── ABI type string for the signed intent tuple ────────────────────────────────
// Matches the Solidity struct:
//   SignedIntent { IntentEnvelope envelope; bytes signature; }
const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

// ── Minimal ABIs (only the functions this script calls) ───────────────────────
const ADAPTER_ABI = [
  // Read the next expected nonce for a given xrplAccount hash
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  // Read which EVM address is the registered session key for a given xrplAccount
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
  // Register / update the session key for a given xrplAccount (admin only)
  "function setIntentSigner(bytes32 xrplAccount, address signer) external",
  // Check whether a market (cToken) is whitelisted in the adapter
  "function marketConfigOf(address) view returns (address underlying, bytes32 tokenId, bool listed)",
  // How much ETH/XRP the adapter uses as gas for outbound ITS transfers (BORROW/WITHDRAW)
  "function egressGasValue() view returns (uint256)",
];

const CTOKEN_ABI = [
  // Current supplied balance for an account (in underlying, simulated — uses staticCall)
  "function balanceOfUnderlying(address) returns (uint256)",
  // Current borrow balance including accrued interest (simulated — uses staticCall)
  "function borrowBalanceCurrent(address) returns (uint256)",
];

const PROXY_FACTORY_ABI = [
  // Returns the XRPLUserProxy address for a given xrplAccount hash (0x0 if not deployed)
  "function proxyOf(bytes32 xrplAccount) view returns (address)",
];

// 1 XRP drop (6 decimals on XRPL) = 1e12 wei (18 decimals on EVM)
const DROPS_TO_EVM = BigInt(1e12);

// ── Action type enum (mirrors the Solidity enum in XRPLSecurdTypes) ────────────
const ACTION = { SUPPLY: 0, BORROW: 1, REPAY: 2, WITHDRAW: 3, ENTER_MARKET: 4, EXIT_MARKET: 5 };

// ── Env helpers ───────────────────────────────────────────────────────────────
function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

// ── XRPL memo helpers ─────────────────────────────────────────────────────────
// All memo fields must be hex-encoded UTF-8 strings except the raw payload.
function utf8Hex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex").toUpperCase();
}
function rawHex(s: string): string {
  return (s.startsWith("0x") ? s.slice(2) : s).toUpperCase();
}

// Build one Memo entry.
// - key:       memo field name  (e.g. "type", "destination_chain")
// - value:     the value to encode
// - isPayload: raw hex passthrough (for the ABI-encoded payload blob)
function memo(key: string, value: string, isPayload = false) {
  const data = isPayload
    ? rawHex(value)
    : key === "destination_address"
      ? utf8Hex(value.replace(/^0x/, "")) // EVM address without 0x prefix
      : utf8Hex(value);
  return { Memo: { MemoType: utf8Hex(key), MemoData: data } };
}

// ── Intent envelope hashing ───────────────────────────────────────────────────
// payloadHash = keccak256(abi.encode(all envelope fields in order))
// This hash is what the session key actually signs (wrapped in a domain digest).
function hashEnvelope(e: {
  intentId: string; xrplAccount: string; market: string; underlying: string;
  actionType: number; amount: bigint; nonce: bigint; deadline: bigint;
  destinationAddress: string; version: number;
}): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","bytes32","address","address","uint8","uint256","uint64","uint64","bytes","uint16"],
      [e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version]
    )
  );
}

// ── ABI-encode the signed intent (envelope + signature) ───────────────────────
// This becomes the "payload" memo field sent to the Axelar gateway.
function encodeSignedIntent(e: any, sig: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_INTENT_TUPLE],
    [[[e.intentId, e.xrplAccount, e.market, e.underlying,
       e.actionType, e.amount, e.nonce, e.deadline, e.destinationAddress, e.version], sig]]
  );
}

// ── Build + sign the payload for one intent ───────────────────────────────────
// Steps:
//   1. Hash the envelope fields (payloadHash)
//   2. Wrap with adapter address + chainId to form the domain digest
//   3. Sign the domain digest with the session key (evmSigner)
//   4. ABI-encode (envelope, signature) → hex string for the XRPL memo
async function buildPayload(
  evmSigner: ethers.Wallet,
  adapterAddr: string,
  chainId: bigint,
  envelope: any
): Promise<string> {
  // Step 1: hash the envelope
  const payloadHash = hashEnvelope(envelope);

  // Step 2: domain-bind the hash so it's only valid for this adapter + chain
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32"],
      [adapterAddr, chainId, payloadHash]
    )
  );

  // Step 3: sign with session key (signMessage applies the Ethereum prefix)
  const sig = await evmSigner.signMessage(ethers.getBytes(digest));

  // Step 4: encode
  return encodeSignedIntent(envelope, sig);
}

// ── Poll until adapter nonce reaches `expected` or timeout ────────────────────
async function pollNonce(
  adapter: ethers.Contract,
  xrplAccount: string,
  expected: bigint,
  timeoutSec: number
): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  process.stdout.write("  Waiting for Axelar relay");
  while (Date.now() < deadline) {
    const n = BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));
    if (n >= expected) { process.stdout.write(" ✓\n"); return; }
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 5000));
  }
  process.stdout.write(" TIMEOUT\n");
  throw new Error(`Relay not confirmed within ${timeoutSec}s`);
}

// ── Submit an XRPL Payment and wait for ledger confirmation ───────────────────
async function submitXrpl(client: Client, wallet: Wallet, tx: Payment): Promise<string> {
  const prepared = await client.autofill(tx);
  const fee = parseInt((prepared as any).Fee ?? "0", 10);
  if (fee > 10_000) throw new Error(`Fee ${fee} drops exceeds safety cap`);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const res = (result as any).result;
  if (res.meta?.TransactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL tx failed: ${res.meta?.TransactionResult}`);
  }
  return res.hash as string;
}

// ── Print the full ordered instruction plan ───────────────────────────────────
function printInstructions(ctx: {
  xrplAddress: string;
  xrplAccount: string;
  proxyAddr: string;
  sessionKeyAddr: string;
  adapterAddr: string;
  market: string;
  underlying: string;
  gateway: string;
  destChain: string;
  chainId: string;
  supplyDrops: bigint;
  borrowXrp: string;
  withdrawXrp: string;
  gmpGasDrops: bigint;
  repayGasDrop: bigint;
  currentNonce: bigint;
  registered: boolean;
  supplied: string;
  borrowed: string;
}) {
  const line = "─".repeat(63);
  console.log("\n" + "═".repeat(63));
  console.log(" FULL EXECUTION PLAN — XRPL → XRPL EVM Lending Flow");
  console.log("═".repeat(63));

  console.log(`
ACCOUNTS & KEYS
  XRPL address   : ${ctx.xrplAddress}
  xrplAccount    : ${ctx.xrplAccount}
                   (= keccak256(utf8("${ctx.xrplAddress}")))
  EVM proxy      : ${ctx.proxyAddr}
                   (XRPLUserProxy — acts on behalf of the XRPL user on EVM)
  Session key    : ${ctx.sessionKeyAddr}
                   (EVM address that signs every intent envelope)

CONTRACTS
  Adapter        : ${ctx.adapterAddr}   (XRPLSecurdBridgeAdapter)
  Market (sXRP)  : ${ctx.market}                   (Compound V2 cToken)
  Underlying     : ${ctx.underlying}   (native XRP sentinel)
  Axelar gateway : ${ctx.gateway}                  (XRPL gateway)
  Chain           : ${ctx.destChain}  (Chain ID ${ctx.chainId})

CURRENT STATE
  Supplied       : ${ctx.supplied} XRP
  Borrowed       : ${ctx.borrowed} XRP
  Next nonce     : ${ctx.currentNonce}
  Session key registered : ${ctx.registered ? "YES ✓" : "NO — must register first (Step 0)"}
`);

  console.log("═".repeat(63));
  console.log(" STEPS IN ORDER");
  console.log("═".repeat(63));

  // ── Step 0 ────────────────────────────────────────────────────────────────
  console.log(`
${line}
 STEP 0 — REGISTER SESSION KEY  (once per user)
${line}
 What  : Tell the adapter which EVM key is allowed to sign intents
         for this XRPL user.  Must be done before any lending action.

 Who calls it : Securd admin (EVM tx, not an XRPL Payment)

 On-chain call:
   Contract  : ${ctx.adapterAddr}
   Function  : setIntentSigner(bytes32 xrplAccount, address signer)
   Args:
     xrplAccount = ${ctx.xrplAccount}
     signer      = ${ctx.sessionKeyAddr}

 Status : ${ctx.registered ? "✓ ALREADY DONE" : "⚠  NOT YET REGISTERED — run this before Step 1"}
`);

  // ── Step 1 ────────────────────────────────────────────────────────────────
  console.log(`${line}
 STEP 1 — SUPPLY  (${Number(ctx.supplyDrops) / 1e6} XRP)
${line}
 Transport : ITS interchain_transfer
             XRP flows XRPL → XRPL EVM.  Adapter calls mint() on sXRP cToken.

 XRPL Payment:
   Account     : ${ctx.xrplAddress}
   Destination : ${ctx.gateway}   (Axelar gateway)
   Amount      : ${ctx.supplyDrops} drops  (= ${Number(ctx.supplyDrops) / 1e6} XRP)

 Memos:
   type                = "interchain_transfer"
   destination_chain   = "${ctx.destChain}"
   destination_address = "${ctx.adapterAddr}"  (no 0x)
   gas_fee_amount      = "0"                  (0 for native XRP ITS)
   payload             = <ABI-encoded SignedIntent>  ← see envelope below

 Intent envelope  (nonce = ${ctx.currentNonce}):
   intentId           = keccak256("xrp-supply:<address>:<nonce>:<timestamp>")
   xrplAccount        = ${ctx.xrplAccount}
   market             = ${ctx.market}
   underlying         = ${ctx.underlying}
   actionType         = 0  (SUPPLY)
   amount             = ${ctx.supplyDrops * BigInt(1e12)} wei  (${ctx.supplyDrops} drops × 10^12)
   nonce              = ${ctx.currentNonce}
   deadline           = 0  (no expiry)
   destinationAddress = 0x  (unused for SUPPLY)
   version            = 1

 Signing:
   payloadHash = keccak256(abi.encode(envelope fields))
   digest      = keccak256(abi.encode(adapterAddr, chainId, payloadHash))
   signature   = sessionKey.sign(digest)
`);

  const n1 = ctx.currentNonce + 1n;

  // ── Step 2 ────────────────────────────────────────────────────────────────
  console.log(`${line}
 STEP 2 — ENTER_MARKET
${line}
 Transport : GMP call_contract
             No tokens move.  Adapter calls enterMarkets([sXRP]) so the
             user's supplied XRP counts as collateral for borrowing.

 XRPL Payment:
   Account     : ${ctx.xrplAddress}
   Destination : ${ctx.gateway}
   Amount      : ${ctx.gmpGasDrops} drops  (= ${Number(ctx.gmpGasDrops) / 1e6} XRP — Axelar relay gas)

 Memos:
   type                = "call_contract"
   destination_chain   = "${ctx.destChain}"
   destination_address = "${ctx.adapterAddr}"
   payload             = <ABI-encoded SignedIntent>

 Intent envelope  (nonce = ${n1}):
   actionType = 4  (ENTER_MARKET)
   amount     = 0
   nonce      = ${n1}
`);

  const n2 = n1 + 1n;

  // ── Step 3 ────────────────────────────────────────────────────────────────
  console.log(`${line}
 STEP 3 — BORROW  (${ctx.borrowXrp} XRP)
${line}
 Transport : GMP call_contract
             No tokens come from XRPL.  Adapter calls borrow() on sXRP,
             then bridges the borrowed XRP back to the user's XRPL address
             via ITS egress (interchainTransfer from EVM → XRPL).

 XRPL Payment:
   Account     : ${ctx.xrplAddress}
   Destination : ${ctx.gateway}
   Amount      : ${ctx.gmpGasDrops} drops  (relay gas)

 Intent envelope  (nonce = ${n2}):
   actionType         = 1  (BORROW)
   amount             = ${ethers.parseEther(ctx.borrowXrp)} wei  (${ctx.borrowXrp} XRP)
   nonce              = ${n2}
   destinationAddress = utf8("${ctx.xrplAddress}")  ← borrowed XRP sent back here
`);

  const n3 = n2 + 1n;

  // ── Step 4 ────────────────────────────────────────────────────────────────
  console.log(`${line}
 STEP 4 — REPAY  (exact outstanding borrow)
${line}
 Transport : ITS interchain_transfer
             Tokens flow XRPL → XRPL EVM.  Adapter calls repayBorrow().
             Amount is read live from borrowBalanceCurrent to avoid over-repay
             (Compound V2 reverts if repayAmount > outstanding).

 XRPL Payment:
   Account     : ${ctx.xrplAddress}
   Destination : ${ctx.gateway}
   Amount      : <repayDrops> + ${ctx.repayGasDrop} drops  (repay + gas)

 Memos:
   type                = "interchain_transfer"
   gas_fee_amount      = "${ctx.repayGasDrop}"  (Axelar deducts this; net bridged = repayDrops)
   payload             = <ABI-encoded SignedIntent>

 Intent envelope  (nonce = ${n3}):
   actionType = 2  (REPAY)
   amount     = <repayDrops × 10^12>  (read from borrowBalanceCurrent at send time)
   nonce      = ${n3}
`);

  const n4 = n3 + 1n;

  // ── Step 5 ────────────────────────────────────────────────────────────────
  console.log(`${line}
 STEP 5 — EXIT_MARKET
${line}
 Transport : GMP call_contract
             No tokens move.  Removes sXRP from the collateral set.
             Reverts if outstanding borrows would become undercollateralized.
             Must be called AFTER full repayment.

 XRPL Payment:
   Amount : ${ctx.gmpGasDrops} drops  (relay gas)

 Intent envelope  (nonce = ${n4}):
   actionType = 5  (EXIT_MARKET)
   amount     = 0
   nonce      = ${n4}
`);

  const n5 = n4 + 1n;

  // ── Step 6 ────────────────────────────────────────────────────────────────
  console.log(`${line}
 STEP 6 — WITHDRAW  (${ctx.withdrawXrp} XRP)
${line}
 Transport : GMP call_contract
             No tokens come from XRPL.  Adapter calls redeemUnderlying() on
             sXRP (burns cTokens, releases underlying XRP), then bridges
             the XRP back to the XRPL address via ITS egress.

 XRPL Payment:
   Account     : ${ctx.xrplAddress}
   Destination : ${ctx.gateway}
   Amount      : ${ctx.gmpGasDrops} drops  (relay gas)

 Intent envelope  (nonce = ${n5}):
   actionType         = 3  (WITHDRAW)
   amount             = ${ethers.parseEther(ctx.withdrawXrp)} wei  (${ctx.withdrawXrp} XRP)
   nonce              = ${n5}
   destinationAddress = utf8("${ctx.xrplAddress}")  ← withdrawn XRP sent back here
`);

  console.log("═".repeat(63));
  console.log(" NONCE SEQUENCE SUMMARY");
  console.log("═".repeat(63));
  console.log(`
  Step 0  setIntentSigner        → EVM tx (no nonce consumed)
  Step 1  SUPPLY                 → nonce ${ctx.currentNonce} → ${n1}
  Step 2  ENTER_MARKET           → nonce ${n1} → ${n2}
  Step 3  BORROW                 → nonce ${n2} → ${n3}
  Step 4  REPAY                  → nonce ${n3} → ${n4}
  Step 5  EXIT_MARKET            → nonce ${n4} → ${n5}
  Step 6  WITHDRAW               → nonce ${n5} → ${n5 + 1n}
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  // ── Load configuration ─────────────────────────────────────────────────────
  const xrplSeed      = req("XRPL_SEED");
  const evmRpcUrl     = req("XRPL_EVM_RPC_URL");
  const sessionKeyHex = req("DEPLOYER_PRIVATE_KEY");   // EVM private key = session key
  const adapterAddr   = req("XRPL_BRIDGE_ADAPTER");
  const market        = req("XRPL_DEPOSIT_MARKET");     // sXRP cToken address
  const underlying    = req("XRPL_DEPOSIT_UNDERLYING"); // 0xEeee...EeE for native XRP

  const xrplRpc       = opt("XRPL_RPC_URL",           "wss://s.altnet.rippletest.net:51233");
  const gateway       = opt("XRPL_AXELAR_GATEWAY",    "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2");
  const destChain     = opt("XRPL_EVM_AXELAR_CHAIN",  "xrpl-evm");
  const gmpGasDrops   = BigInt(opt("XRPL_GMP_GAS_DROPS",       "3000000")); // 3 XRP
  const repayGasDrop  = BigInt(opt("XRPL_REPAY_GAS_FEE_DROPS", "2000000")); // 2 XRP
  const timeoutSec    = parseInt(opt("XRPL_RELAY_TIMEOUT_SEC",  "120"), 10);
  const startFromStep = parseInt(opt("XRPL_START_FROM_STEP",    "1"),   10);
  const confirmSend   = process.env.XRPL_CONFIRM_SEND === "true";

  // Flow amounts (adjust freely)
  const SUPPLY_DROPS   = 10_000_000n;  // 10 XRP in drops (6 decimals)
  const BORROW_XRP     = "1";          // 1 XRP to borrow
  const WITHDRAW_XRP   = "10";         // 10 XRP to withdraw

  // ── Init XRPL wallet and EVM signer ───────────────────────────────────────
  const xrplWallet = Wallet.fromSeed(xrplSeed);
  const provider   = new ethers.JsonRpcProvider(evmRpcUrl);
  const network    = await provider.getNetwork();
  const chainId    = network.chainId;

  // Session key: the EVM signer whose address is registered in the adapter
  // for this XRPL user.  Signs every intent envelope.
  const evmSigner  = new ethers.Wallet(sessionKeyHex, provider);

  const adapter = new ethers.Contract(adapterAddr, ADAPTER_ABI, provider);
  const cxrp    = new ethers.Contract(market, CTOKEN_ABI, provider);
  const factory = new ethers.Contract(
    "0xB7f3ECe856063F48BC3bcC7A381aE875841663aA",
    PROXY_FACTORY_ABI, provider
  );

  // xrplAccount = keccak256(utf8(xrplAddress))
  // This is the on-chain identity for the XRPL user — used for nonces, proxy
  // lookup, and signature verification.
  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplWallet.address));

  const proxyAddr = await factory.proxyOf(xrplAccount);
  const getNonce  = async () => BigInt(await adapter.nextNonceByXrplAccount(xrplAccount));

  // ── Print session info ─────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Securd XRP Lending Flow");
  console.log("═══════════════════════════════════════════════════════");
  console.log("XRPL address     :", xrplWallet.address);
  console.log("xrplAccount hash :", xrplAccount);
  console.log("EVM proxy        :", proxyAddr);
  console.log("Session key addr :", evmSigner.address, "  ← signs all intent envelopes");
  console.log("Adapter          :", adapterAddr);
  console.log("Market (sXRP)    :", market);
  console.log("Underlying       :", underlying);
  console.log("Chain ID         :", chainId.toString());
  console.log("Axelar gateway   :", gateway);
  console.log("Confirm send     :", confirmSend);
  if (!confirmSend) console.log("\nDRY RUN — set XRPL_CONFIRM_SEND=true to execute.\n");

  // ── Check market is listed in adapter ─────────────────────────────────────
  const mktConfig = await adapter.marketConfigOf(market);
  if (!mktConfig.listed) throw new Error(`Market ${market} is not listed in the adapter`);
  console.log("\nMarket listed in adapter ✓");

  // ── Step 0: Registration check + auto-register ────────────────────────────
  //
  // The adapter must know which EVM address is allowed to sign intents for this
  // XRPL user.  Read the currently registered signer.  If it's not set (or
  // differs from our session key), call setIntentSigner to register it.
  //
  // setIntentSigner is an admin-only call.  In this script DEPLOYER_PRIVATE_KEY
  // is also the admin, so we can self-register.  In production the backend calls
  // this once when the user first connects their XRPL wallet.
  //
  console.log("\n─── Registration Check ─────────────────────────────────");
  const registeredSigner = await adapter.intentSignerOfXrplAccount(xrplAccount);
  console.log("Registered signer on-chain :", registeredSigner);
  console.log("Our session key            :", evmSigner.address);

  if (registeredSigner.toLowerCase() === evmSigner.address.toLowerCase()) {
    console.log("Session key matches ✓  — no registration needed.");
  } else {
    console.log("Session key NOT registered.  Calling setIntentSigner...");
    if (!confirmSend) {
      console.log("[dry run] Would call adapter.setIntentSigner(xrplAccount, sessionKey)");
    } else {
      // Need the admin signer (same key in this setup)
      const adminSigner = new ethers.Wallet(sessionKeyHex, provider);
      const adapterWithAdmin = new ethers.Contract(adapterAddr, ADAPTER_ABI, adminSigner);
      const tx = await adapterWithAdmin.setIntentSigner(xrplAccount, evmSigner.address);
      await tx.wait();
      console.log("  setIntentSigner done. TX:", tx.hash);
    }
  }

  // ── Show current proxy state + full instruction plan ─────────────────────
  const curNonce    = await getNonce();
  const egressGas   = await adapter.egressGasValue();
  let curSupplied = 0n, curBorrowed = 0n;
  if (proxyAddr !== ethers.ZeroAddress) {
    curSupplied = await cxrp.balanceOfUnderlying.staticCall(proxyAddr);
    curBorrowed = await cxrp.borrowBalanceCurrent.staticCall(proxyAddr);
    console.log("\n─── Current Proxy State ────────────────────────────────");
    console.log("  Supplied :", ethers.formatEther(curSupplied), "XRP");
    console.log("  Borrowed :", ethers.formatEther(curBorrowed), "XRP");
    console.log("  Nonce    :", curNonce.toString(), "  ← next intent must use this value");
    console.log("  Egress gas value:", ethers.formatEther(egressGas), "XRP  (for BORROW/WITHDRAW callbacks)");
  }

  printInstructions({
    xrplAddress:    xrplWallet.address,
    xrplAccount,
    proxyAddr,
    sessionKeyAddr: evmSigner.address,
    adapterAddr,
    market,
    underlying,
    gateway,
    destChain,
    chainId:        chainId.toString(),
    supplyDrops:    SUPPLY_DROPS,
    borrowXrp:      BORROW_XRP,
    withdrawXrp:    WITHDRAW_XRP,
    gmpGasDrops,
    repayGasDrop,
    currentNonce:   curNonce,
    registered:     registeredSigner.toLowerCase() === evmSigner.address.toLowerCase(),
    supplied:       ethers.formatEther(curSupplied),
    borrowed:       ethers.formatEther(curBorrowed),
  });

  const hashes: Record<string, string> = {};

  const client = new Client(xrplRpc);
  if (confirmSend) await client.connect();

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1 — SUPPLY 10 XRP
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Transport : ITS interchain_transfer
    //   XRP drops are bridged from XRPL to XRPL EVM by Axelar ITS.
    //   The adapter receives them via executeWithInterchainToken().
    //
    // XRPL Payment:
    //   Amount        = supply drops (no gas included — gas is always 0 for native XRP ITS)
    //   Destination   = Axelar gateway
    //   Memo type     = "interchain_transfer"
    //   Memo payload  = ABI-encoded (IntentEnvelope, signature)
    //
    // Intent envelope:
    //   actionType = SUPPLY (0)
    //   amount     = drops × 10^12  (converts 6-dec drops to 18-dec EVM wei)
    //   nonce      = current adapter nonce for this user (read fresh)
    //
    if (startFromStep <= 1) {
      console.log("\n═══ 1. SUPPLY 10 XRP (ITS interchain_transfer) ═══════");
      const nonce    = await getNonce();

      // intentId: a unique bytes32 per intent — prevents cross-chain replay
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `xrp-supply:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));

      const envelope = {
        intentId,
        xrplAccount,
        market,
        underlying,
        actionType: ACTION.SUPPLY,
        amount:     SUPPLY_DROPS * DROPS_TO_EVM,  // 10_000_000 drops × 1e12 = 10e18 wei
        nonce,
        deadline:   BigInt(0),            // 0 = no expiry
        destinationAddress: "0x",         // not used for SUPPLY
        version:    1,
      };

      console.log("  Intent envelope:");
      console.log("    intentId       :", envelope.intentId);
      console.log("    xrplAccount    :", envelope.xrplAccount);
      console.log("    market         :", envelope.market);
      console.log("    actionType     :", envelope.actionType, "(SUPPLY)");
      console.log("    amount (wei)   :", envelope.amount.toString());
      console.log("    nonce          :", envelope.nonce.toString());

      const payload = await buildPayload(evmSigner, adapterAddr, chainId, envelope);

      const tx: Payment = {
        TransactionType: "Payment",
        Account:     xrplWallet.address,
        Amount:      SUPPLY_DROPS.toString(),   // XRP to bridge (drops, no gas added)
        Destination: gateway,
        Memos: [
          memo("type",                "interchain_transfer"),
          memo("destination_address", adapterAddr),
          memo("destination_chain",   destChain),
          memo("gas_fee_amount",      "0"),      // 0 for native XRP — gas covered separately
          memo("payload",             payload, true),
        ],
      };

      console.log(`  Sending ${Number(SUPPLY_DROPS) / 1e6} XRP (${SUPPLY_DROPS} drops) to Axelar gateway`);

      if (!confirmSend) {
        console.log("  [dry run] payload bytes:", payload.length / 2 - 1, "bytes");
        console.log("  [dry run] SUPPLY tx built OK");
      } else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["1_SUPPLY"] = hash;
        console.log(`  XRPL TX : https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar  : https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
        const supplied = await cxrp.balanceOfUnderlying.staticCall(proxyAddr);
        console.log("  Supplied balance (EVM):", ethers.formatEther(supplied), "XRP");
      }
    } else {
      console.log(`\n═══ 1. SUPPLY — skipped (startFromStep=${startFromStep}) ═══`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2 — ENTER_MARKET
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Transport : GMP call_contract
    //   No tokens move.  This tells Compound to count the user's sXRP balance
    //   as collateral — required before borrowing against it.
    //
    // XRPL Payment:
    //   Amount      = GMP gas drops (3 XRP) — pays Axelar relay cost
    //   Memo type   = "call_contract"
    //   No "gas_fee_amount" memo — the Amount IS the gas.
    //
    // Intent envelope:
    //   actionType = ENTER_MARKET (4)
    //   amount     = 0
    //
    if (startFromStep <= 2) {
      console.log("\n═══ 2. ENTER_MARKET (GMP call_contract) ══════════════");
      const nonce    = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `xrp-enter:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: ACTION.ENTER_MARKET,
        amount:     BigInt(0),
        nonce,
        deadline:   BigInt(0),
        destinationAddress: "0x",
        version:    1,
      };
      const payload = await buildPayload(evmSigner, adapterAddr, chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account:     xrplWallet.address,
        Amount:      gmpGasDrops.toString(),   // gas for Axelar relay (3 XRP)
        Destination: gateway,
        Memos: [
          memo("type",                "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain",   destChain),
          memo("payload",             payload, true),
        ],
      };
      console.log(`  Gas: ${Number(gmpGasDrops) / 1e6} XRP  (Axelar relay fee)`);
      console.log(`  Nonce: ${nonce.toString()}`);
      if (!confirmSend) {
        console.log("  [dry run] ENTER_MARKET payload built OK");
      } else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["2_ENTER_MARKET"] = hash;
        console.log(`  XRPL TX : https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar  : https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
        console.log("  Market entered ✓  (sXRP now counts as collateral)");
      }
    } else {
      console.log(`\n═══ 2. ENTER_MARKET — skipped ═══`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3 — BORROW 1 XRP
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Transport : GMP call_contract
    //   No tokens come from XRPL.  The adapter calls borrow() on the cToken,
    //   then uses ITS to bridge the borrowed XRP back to the user's XRPL address
    //   (the "egress" path inside the adapter).
    //
    // Intent envelope:
    //   actionType         = BORROW (1)
    //   amount             = borrow amount in EVM wei (18 dec)
    //   destinationAddress = utf8(xrplAddress)  — where to send the borrowed XRP
    //
    if (startFromStep <= 3) {
      console.log("\n═══ 3. BORROW 1 XRP (GMP call_contract) ══════════════");
      const nonce    = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `xrp-borrow:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));

      // destinationAddress: where the borrowed XRP is sent back on XRPL
      // Must be ABI-compatible bytes — use utf8 encoding of the XRPL address
      const destBytes = ethers.hexlify(ethers.toUtf8Bytes(xrplWallet.address));

      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: ACTION.BORROW,
        amount:     ethers.parseEther(BORROW_XRP),  // 1e18 wei = 1 XRP on EVM
        nonce,
        deadline:   BigInt(0),
        destinationAddress: destBytes,   // utf8(xrplAddress) → borrowed XRP sent here
        version:    1,
      };

      console.log(`  Borrowing   : ${BORROW_XRP} XRP`);
      console.log(`  Repay dest  : ${xrplWallet.address}  (utf8-encoded in envelope)`);
      console.log(`  Nonce       : ${nonce.toString()}`);

      const payload = await buildPayload(evmSigner, adapterAddr, chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account:     xrplWallet.address,
        Amount:      gmpGasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type",                "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain",   destChain),
          memo("payload",             payload, true),
        ],
      };
      if (!confirmSend) {
        console.log("  [dry run] BORROW payload built OK");
      } else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["3_BORROW"] = hash;
        console.log(`  XRPL TX : https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar  : https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
        const borrowBal = await cxrp.borrowBalanceCurrent.staticCall(proxyAddr);
        console.log("  Borrow balance (EVM):", ethers.formatEther(borrowBal), "XRP");
      }
    } else {
      console.log(`\n═══ 3. BORROW — skipped ═══`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4 — REPAY (exact borrow balance, read live)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Transport : ITS interchain_transfer
    //   Tokens flow from XRPL → EVM just like SUPPLY, but the adapter calls
    //   repayBorrow() instead of mint().
    //
    // Why read live balance?
    //   Compound V2 reverts if you repay MORE than outstanding.  We read
    //   borrowBalanceCurrent (which includes accrued interest) and send exactly
    //   that amount, ceiled to the nearest drop to avoid under-repay.
    //
    // XRPL Payment:
    //   Amount = repayDrops + gasFeeDrops
    //   Memo gas_fee_amount = gasFeeDrops  (Axelar relay fee; taken from the Amount)
    //   The net tokens bridged = Amount − gas_fee_amount = repayDrops
    //
    if (startFromStep <= 4) {
      console.log("\n═══ 4. REPAY (ITS interchain_transfer) ═══════════════");

      // Read exact live borrow balance (accrues per block)
      const borrowBalEVM = await cxrp.borrowBalanceCurrent.staticCall(proxyAddr);
      // Convert EVM wei → drops, ceiling to avoid under-repay
      const repayDrops = (borrowBalEVM + DROPS_TO_EVM - 1n) / DROPS_TO_EVM;
      const totalDrops = repayDrops + repayGasDrop;

      console.log("  Borrow balance (EVM) :", ethers.formatEther(borrowBalEVM), "XRP");
      console.log("  Repay amount (drops) :", repayDrops.toString(), `(${Number(repayDrops) / 1e6} XRP)`);
      console.log("  Gas fee (drops)      :", repayGasDrop.toString(), `(${Number(repayGasDrop) / 1e6} XRP)`);
      console.log("  Total XRPL Payment   :", Number(totalDrops) / 1e6, "XRP  (repay + gas)");

      const nonce    = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `xrp-repay:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: ACTION.REPAY,
        amount:     repayDrops * DROPS_TO_EVM,   // exact repay in EVM wei
        nonce,
        deadline:   BigInt(0),
        destinationAddress: "0x",
        version:    1,
      };
      const payload = await buildPayload(evmSigner, adapterAddr, chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account:     xrplWallet.address,
        Amount:      totalDrops.toString(),          // repay + gas
        Destination: gateway,
        Memos: [
          memo("type",                "interchain_transfer"),
          memo("destination_address", adapterAddr),
          memo("destination_chain",   destChain),
          memo("gas_fee_amount",      repayGasDrop.toString()),  // Axelar deducts this
          memo("payload",             payload, true),
        ],
      };
      if (!confirmSend) {
        console.log("  [dry run] REPAY payload built OK");
      } else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["4_REPAY"] = hash;
        console.log(`  XRPL TX : https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar  : https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
        const borrowAfter = await cxrp.borrowBalanceCurrent.staticCall(proxyAddr);
        console.log("  Borrow balance after repay:", ethers.formatEther(borrowAfter), "XRP");
      }
    } else {
      console.log(`\n═══ 4. REPAY — skipped ═══`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5 — EXIT_MARKET
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Transport : GMP call_contract
    //   No tokens move.  Removes sXRP from the collateral set.
    //   Will revert if the user still has an outstanding borrow that would
    //   become undercollateralized after removing this market.
    //
    if (startFromStep <= 5) {
      console.log("\n═══ 5. EXIT_MARKET (GMP call_contract) ═══════════════");
      const nonce    = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `xrp-exit:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: ACTION.EXIT_MARKET,
        amount:     BigInt(0),
        nonce,
        deadline:   BigInt(0),
        destinationAddress: "0x",
        version:    1,
      };
      const payload = await buildPayload(evmSigner, adapterAddr, chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account:     xrplWallet.address,
        Amount:      gmpGasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type",                "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain",   destChain),
          memo("payload",             payload, true),
        ],
      };
      console.log(`  Gas: ${Number(gmpGasDrops) / 1e6} XRP  |  Nonce: ${nonce.toString()}`);
      if (!confirmSend) {
        console.log("  [dry run] EXIT_MARKET payload built OK");
      } else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["5_EXIT_MARKET"] = hash;
        console.log(`  XRPL TX : https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar  : https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
        console.log("  Market exited ✓  (sXRP no longer used as collateral)");
      }
    } else {
      console.log(`\n═══ 5. EXIT_MARKET — skipped ═══`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6 — WITHDRAW 10 XRP
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Transport : GMP call_contract
    //   No tokens come from XRPL.  The adapter calls redeemUnderlying() on
    //   the cToken (burns cTokens, releases underlying XRP), then bridges the
    //   XRP back to the user's XRPL address via ITS egress.
    //
    // Intent envelope:
    //   actionType         = WITHDRAW (3)
    //   amount             = amount to withdraw in EVM wei
    //   destinationAddress = utf8(xrplAddress)  — where to send the XRP on XRPL
    //
    if (startFromStep <= 6) {
      console.log("\n═══ 6. WITHDRAW 10 XRP (GMP call_contract) ══════════");
      const nonce    = await getNonce();
      const intentId = ethers.keccak256(ethers.toUtf8Bytes(
        `xrp-withdraw:${xrplWallet.address}:${nonce}:${Date.now()}`
      ));
      const destBytes = ethers.hexlify(ethers.toUtf8Bytes(xrplWallet.address));
      const envelope = {
        intentId, xrplAccount, market, underlying,
        actionType: ACTION.WITHDRAW,
        amount:     ethers.parseEther(WITHDRAW_XRP),
        nonce,
        deadline:   BigInt(0),
        destinationAddress: destBytes,   // utf8(xrplAddress) — withdrawn XRP sent here
        version:    1,
      };

      console.log(`  Withdrawing : ${WITHDRAW_XRP} XRP → ${xrplWallet.address}`);
      console.log(`  Nonce       : ${nonce.toString()}`);

      const payload = await buildPayload(evmSigner, adapterAddr, chainId, envelope);
      const tx: Payment = {
        TransactionType: "Payment",
        Account:     xrplWallet.address,
        Amount:      gmpGasDrops.toString(),
        Destination: gateway,
        Memos: [
          memo("type",                "call_contract"),
          memo("destination_address", adapterAddr),
          memo("destination_chain",   destChain),
          memo("payload",             payload, true),
        ],
      };
      if (!confirmSend) {
        console.log("  [dry run] WITHDRAW payload built OK");
      } else {
        const hash = await submitXrpl(client, xrplWallet, tx);
        hashes["6_WITHDRAW"] = hash;
        console.log(`  XRPL TX : https://testnet.xrpl.org/transactions/${hash}`);
        console.log(`  Axelar  : https://testnet.axelarscan.io/gmp/${hash.toLowerCase()}`);
        await pollNonce(adapter, xrplAccount, nonce + 1n, timeoutSec);
      }
    } else {
      console.log(`\n═══ 6. WITHDRAW — skipped ═══`);
    }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════");
    console.log(" Summary");
    console.log("═══════════════════════════════════════════════════════");
    if (confirmSend) {
      for (const [step, hash] of Object.entries(hashes)) {
        console.log(`  ${step.padEnd(20)}: https://testnet.xrpl.org/transactions/${hash}`);
      }
      if (proxyAddr !== ethers.ZeroAddress) {
        const supplied = await cxrp.balanceOfUnderlying.staticCall(proxyAddr);
        const borrowed = await cxrp.borrowBalanceCurrent.staticCall(proxyAddr);
        const nonce    = await adapter.nextNonceByXrplAccount(xrplAccount);
        console.log("\nFinal proxy state:");
        console.log("  Supplied :", ethers.formatEther(supplied), "XRP");
        console.log("  Borrowed :", ethers.formatEther(borrowed), "XRP");
        console.log("  Nonce    :", nonce.toString());
      }
    } else {
      console.log("Dry run complete — all payloads built and signed successfully.");
      console.log("Set XRPL_CONFIRM_SEND=true to submit live transactions.");
    }

  } finally {
    if (confirmSend) await client.disconnect();
  }
}

main().catch(e => { console.error(e.message ?? e); process.exitCode = 1; });
