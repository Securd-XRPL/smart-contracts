/**
 * Fetches all XRPL→Axelar transactions from rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB,
 * cross-references with on-chain IntentExecuted events, and decodes payload memos
 * to identify the lending action type for unmatched (failed) transactions.
 *
 * Run: npx hardhat run scripts/decodeFailedTxTypes.ts --network xrplEvm
 */
import { ethers } from "hardhat";
import { Client } from "xrpl";

const XRPL_ADDRESS  = "rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB";
const XRPL_ACCOUNT  = "0xb2e98690a6e04b7f2eff91e0ca615122753fd8ae6e62eeeafe7c88169e9b7a09";
const ADAPTER_ADDR  = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const SCAN_FROM     = 6800000;
const XRPL_NODE     = process.env.XRPL_RPC_URL ?? "wss://s.altnet.rippletest.net:51233";
const RIPPLE_EPOCH  = 946684800; // Jan 1 2000 00:00:00 UTC in Unix seconds

const ACTION = ["SUPPLY", "BORROW", "REPAY", "WITHDRAW", "ENTER_MARKET", "EXIT_MARKET"];

// Axelar gateway addresses on XRPL (used to identify gateway-bound payments)
const AXELAR_GATEWAYS = new Set([
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", // placeholder — real ones below
  "r4GDFMLGJUKMjNEycSZGYGWjPeE3MVbFoR", // Axelar XRPL EVM testnet gateway
  "rP9jPyP5kyvFRb6ZiRghAGw5u8SGAmU4bd",
]);

const SIGNED_INTENT_TUPLE =
  "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)";

const ADAPTER_ABI = [
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
];

function toUtcString(rippleTime: number): string {
  const unixMs = (rippleTime + RIPPLE_EPOCH) * 1000;
  return new Date(unixMs).toISOString().replace("T", " ").slice(0, 19);
}

function decodeActionType(memoDataHex: string): string {
  try {
    const bytes = Buffer.from(memoDataHex, "hex");
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([SIGNED_INTENT_TUPLE], bytes);
    const envelope = decoded[0][0];
    const actionType = Number(envelope[4]);
    return ACTION[actionType] ?? `UNKNOWN(${actionType})`;
  } catch {
    return "DECODE_ERR";
  }
}

function extractIntentId(memoDataHex: string): string | null {
  try {
    const bytes = Buffer.from(memoDataHex, "hex");
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([SIGNED_INTENT_TUPLE], bytes);
    const envelope = decoded[0][0];
    return (envelope[0] as string).toLowerCase();
  } catch {
    return null;
  }
}

function extractAmount(memoDataHex: string): string {
  try {
    const bytes = Buffer.from(memoDataHex, "hex");
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([SIGNED_INTENT_TUPLE], bytes);
    const envelope = decoded[0][0];
    const amt: bigint = envelope[5]; // uint256 amount (wei)
    return ethers.formatEther(amt) + " XRP";
  } catch {
    return "—";
  }
}

function getTxHash(entry: any): string {
  // xrpl.js v4 puts hash at different places depending on method
  return (
    entry.hash ??
    entry.tx?.hash ??
    entry.tx?.Hash ??
    entry.tx_json?.hash ??
    entry.tx_json?.Hash ??
    "?"
  );
}

const PAYLOAD_TYPE_HEX = Buffer.from("payload", "utf8").toString("hex").toUpperCase();

function getMemoData(tx: any): string | null {
  const memos: any[] = tx.Memos ?? [];
  for (const m of memos) {
    const obj = m.Memo ?? m;
    if ((obj.MemoType ?? "").toUpperCase() === PAYLOAD_TYPE_HEX) {
      return obj.MemoData ?? null;
    }
  }
  return null;
}

function hasPayloadMemo(tx: any): boolean {
  return getMemoData(tx) !== null;
}

async function queryChunks(adapter: ethers.Contract, filter: any, from: number, to: number) {
  const CHUNK = 5000;
  const events: any[] = [];
  for (let s = from; s <= to; s += CHUNK) {
    const e = Math.min(s + CHUNK - 1, to);
    events.push(...await adapter.queryFilter(filter, s, e));
  }
  return events;
}

async function main() {
  // ── 1. Fetch all on-chain IntentExecuted for this user ─────────────────────
  const provider = ethers.provider;
  const latest   = await provider.getBlockNumber();
  const adapter  = new ethers.Contract(ADAPTER_ADDR, ADAPTER_ABI, provider);
  const executed = await queryChunks(
    adapter,
    adapter.filters.IntentExecuted(null, XRPL_ACCOUNT),
    SCAN_FROM, latest
  );
  const successIntentIds = new Set(executed.map((e: any) => e.args.intentId.toLowerCase()));
  console.log(`\nOn-chain IntentExecuted count : ${executed.length}`);

  // ── 2. Fetch all transactions from the XRPL address ───────────────────────
  const client = new Client(XRPL_NODE);
  await client.connect();

  let marker: any = undefined;
  const allTxs: any[] = [];

  do {
    const req: any = {
      command:        "account_tx",
      account:        XRPL_ADDRESS,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit:          200,
      forward:        true,
    };
    if (marker) req.marker = marker;

    const resp = await client.request(req);
    const result: any = resp.result;
    allTxs.push(...(result.transactions ?? []));
    marker = result.marker;
  } while (marker);

  console.log(`XRPL transactions fetched     : ${allTxs.length}`);

  // ── 3. Filter only transactions with a payload memo ───────────────────────
  const payloadTxs = allTxs.filter(entry => {
    const tx = entry.tx ?? entry.tx_json ?? entry;
    return hasPayloadMemo(tx);
  });
  console.log(`Transactions with payload memo : ${payloadTxs.length}`);

  // ── 4. Decode each and classify ───────────────────────────────────────────
  console.log("\n" + "═".repeat(100));
  console.log("  Full Transaction History — " + XRPL_ADDRESS);
  console.log("═".repeat(100));
  console.log(
    `  ${"#".padEnd(3)}  ` +
    `${"Date (UTC)".padEnd(22)}  ` +
    `${"Bridge".padEnd(6)}  ` +
    `${"Action".padEnd(14)}  ` +
    `${"Amount (drops)".padEnd(18)}  ` +
    `${"Status".padEnd(10)}  ` +
    `Hash`
  );
  console.log("─".repeat(100));

  let seq = 0;
  for (const entry of payloadTxs) {
    const tx   = entry.tx ?? entry.tx_json ?? entry;

    const hash       = getTxHash(entry);
    const rippleDate = tx.date ?? tx.Date ?? 0;
    const dateStr    = toUtcString(rippleDate);

    const payloadHex = getMemoData(tx) ?? "";
    const actionType = decodeActionType(payloadHex);
    const intentId   = extractIntentId(payloadHex);
    const status     = intentId && successIntentIds.has(intentId) ? "SUCCESS ✓" : "FAILED  ✗";
    const amtDisplay = extractAmount(payloadHex);

    // ITS = SUPPLY or REPAY; GMP = all others
    const at = ACTION.indexOf(actionType);
    const bridgeType = (at === 0 || at === 2) ? "ITS" : "GMP";

    seq++;
    const short = hash !== "?" ? hash.slice(0, 20) + "..." : "?";
    console.log(
      `  ${String(seq).padEnd(3)}  ` +
      `${dateStr.padEnd(22)}  ` +
      `${bridgeType.padEnd(6)}  ` +
      `${actionType.padEnd(14)}  ` +
      `${amtDisplay.padEnd(18)}  ` +
      `${status.padEnd(10)}  ` +
      short
    );
  }

  console.log("═".repeat(100));

  // ── 5. Summary of failed ones only ────────────────────────────────────────
  console.log("\n── Failed / Unmatched Transactions ──────────────────────────────────────────────\n");
  console.log(
    `  ${"#".padEnd(3)}  ` +
    `${"Date (UTC)".padEnd(22)}  ` +
    `${"Bridge".padEnd(6)}  ` +
    `${"Action".padEnd(14)}  ` +
    `${"Amount".padEnd(18)}  ` +
    `Hash`
  );
  console.log("─".repeat(90));

  let failSeq = 0;
  for (const entry of payloadTxs) {
    const tx         = entry.tx ?? entry.tx_json ?? entry;
    const hash       = getTxHash(entry);
    const rippleDate = tx.date ?? tx.Date ?? 0;
    const dateStr    = toUtcString(rippleDate);
    const payloadHex = getMemoData(tx) ?? "";
    const actionType = decodeActionType(payloadHex);
    const intentId   = extractIntentId(payloadHex);

    if (intentId && successIntentIds.has(intentId)) continue;

    const amtDisplay = extractAmount(payloadHex);
    const at = ACTION.indexOf(actionType);
    const bridgeType = (at === 0 || at === 2) ? "ITS" : "GMP";

    failSeq++;
    console.log(
      `  ${String(failSeq).padEnd(3)}  ` +
      `${dateStr.padEnd(22)}  ` +
      `${bridgeType.padEnd(6)}  ` +
      `${actionType.padEnd(14)}  ` +
      `${amtDisplay.padEnd(18)}  ` +
      hash
    );
  }

  if (failSeq === 0) console.log("  None found.\n");
  else console.log(`\n  Total failed: ${failSeq}\n`);

  await client.disconnect();
}

main().catch(e => { console.error(e); process.exitCode = 1; });
