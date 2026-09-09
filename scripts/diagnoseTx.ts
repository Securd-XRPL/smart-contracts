import { ethers } from "hardhat";

const ADAPTER  = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const FACTORY  = "0x3C03CF51E4BFa50B5482165Cc053D71698b780f4";

// New user
const XRPL_ADDR = "rBSKvJNZWwLPUgHR17xjCSWSACQyCsFnCt";
const XRPL_ACC  = ethers.keccak256(ethers.toUtf8Bytes(XRPL_ADDR));

// From decoded intents
const SUPPLY_INTENT_ID  = "0xb97d3cc5b310c88353c0ba9464c7c7913a9b369756370f66b67283ff15410ec3";
const WITHDRAW_INTENT_ID = "0x5a6abc2c394b6de4b6dd2effdf4a38279b1a3fbfce12f443561c7ed5da3a7de3";

const ACTION = ["SUPPLY","BORROW","REPAY","WITHDRAW","ENTER_MARKET","EXIT_MARKET"];

const ABI = [
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
  "function payloadHashByIntent(bytes32) view returns (bytes32)",
  "function marketConfigOf(address) view returns (address underlying, bytes32 tokenId, bool listed)",
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
];

const FACTORY_ABI = ["function proxyOf(bytes32) view returns (address)"];

const CXRP    = "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318";
const CTOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
  "function getCash() view returns (uint256)",
];

async function main() {
  const provider = ethers.provider;
  const latest   = await provider.getBlockNumber();
  const adapter  = new ethers.Contract(ADAPTER, ABI, provider);
  const factory  = new ethers.Contract(FACTORY, FACTORY_ABI, provider);

  console.log("\n══ Diagnosis for", XRPL_ADDR, "══");
  console.log("  Current block :", latest);

  // 1. Intent replay-protection slots
  const [supplyUsed, withdrawUsed] = await Promise.all([
    adapter.payloadHashByIntent(SUPPLY_INTENT_ID),
    adapter.payloadHashByIntent(WITHDRAW_INTENT_ID),
  ]);
  console.log("\n── Intent status ────────────────────────────────────");
  console.log("  SUPPLY  intentId :", SUPPLY_INTENT_ID.slice(0,20)+"...");
  console.log("  SUPPLY  payloadHashByIntent slot :", supplyUsed === ethers.ZeroHash ? "EMPTY (never processed)" : "SET → " + supplyUsed.slice(0,20)+"...");
  console.log("  WITHDRAW intentId:", WITHDRAW_INTENT_ID.slice(0,20)+"...");
  console.log("  WITHDRAW payloadHashByIntent slot:", withdrawUsed === ethers.ZeroHash ? "EMPTY (never processed)" : "SET → " + withdrawUsed.slice(0,20)+"...");

  // 2. Nonce
  const nonce  = await adapter.nextNonceByXrplAccount(XRPL_ACC);
  const signer = await adapter.intentSignerOfXrplAccount(XRPL_ACC);
  const proxy  = await factory.proxyOf(XRPL_ACC);
  console.log("\n── Account state ────────────────────────────────────");
  console.log("  Next nonce   :", nonce.toString());
  console.log("  Signer       :", signer);
  console.log("  Proxy        :", proxy === ethers.ZeroAddress ? "none" : proxy);

  // 3. Market config for cXRP
  const cfg = await adapter.marketConfigOf(CXRP);
  console.log("\n── cXRP market config in adapter ────────────────────");
  console.log("  underlying   :", cfg.underlying);
  console.log("  tokenId      :", cfg.tokenId);
  console.log("  listed       :", cfg.listed);

  // 4. If proxy exists, check balances
  if (proxy !== ethers.ZeroAddress) {
    const cToken = new ethers.Contract(CXRP, CTOKEN_ABI, provider);
    const [cBal, exchRate, borrow] = await Promise.all([
      cToken.balanceOf(proxy),
      cToken.exchangeRateStored(),
      cToken.borrowBalanceStored(proxy),
    ]);
    const underlying = (cBal * exchRate) / ethers.parseEther("1");
    console.log("\n── Proxy balances ───────────────────────────────────");
    console.log("  cXRP balance :", cBal.toString());
    console.log("  Underlying   :", ethers.formatEther(underlying), "XRP");
    console.log("  Borrow       :", ethers.formatEther(borrow), "XRP");
  }

  // 5. Scan ALL IntentExecuted in last 100k blocks for this account
  console.log("\n── IntentExecuted scan (last 100k blocks) ───────────");
  const from  = Math.max(0, latest - 100000);
  const CHUNK = 5000;
  const events: any[] = [];
  for (let s = from; s <= latest; s += CHUNK) {
    const e = Math.min(s + CHUNK - 1, latest);
    const ev = await adapter.queryFilter(adapter.filters.IntentExecuted(null, XRPL_ACC), s, e);
    events.push(...ev);
  }
  if (events.length === 0) {
    console.log("  No IntentExecuted found in blocks", from, "→", latest);
  } else {
    for (const e of events) {
      console.log(`  [block ${e.blockNumber}] ${ACTION[Number(e.args.actionType)]} — tx: ${e.transactionHash}`);
    }
  }

  // 6. Verdict
  console.log("\n── Verdict ──────────────────────────────────────────");
  if (supplyUsed === ethers.ZeroHash && withdrawUsed === ethers.ZeroHash && nonce === 1n) {
    console.log("  ⚠  SUPPLY payloadHashByIntent is EMPTY but nonce=1.");
    console.log("     This means the SUPPLY intent nonce was consumed by a DIFFERENT");
    console.log("     mechanism (e.g. a direct admin nonce reset), OR the intent was");
    console.log("     processed and then the payloadHashByIntent check is keyed differently.");
  } else if (supplyUsed !== ethers.ZeroHash && withdrawUsed === ethers.ZeroHash) {
    console.log("  SUPPLY was processed (payloadHashByIntent SET).");
    console.log("  WITHDRAW was NOT processed (payloadHashByIntent EMPTY) — relay pending or rejected.");
  } else if (supplyUsed === ethers.ZeroHash && withdrawUsed === ethers.ZeroHash) {
    console.log("  Neither intent reached EVM execution.");
    console.log("  Both Axelar relay transactions may still be pending or were dropped.");
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
