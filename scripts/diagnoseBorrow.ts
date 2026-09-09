import { ethers } from "hardhat";

const ADAPTER   = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const FACTORY   = "0x3C03CF51E4BFa50B5482165Cc053D71698b780f4";
const XRPL_ADDR = "rBSKvJNZWwLPUgHR17xjCSWSACQyCsFnCt";
const XRPL_ACC  = ethers.keccak256(ethers.toUtf8Bytes(XRPL_ADDR));
const SSTST     = "0x2F874D87E685EC28be749B781dc99119F27CF0be";
const SCAN_FROM = 6900000;
const CHUNK     = 5000;

const ACTION = ["SUPPLY","BORROW","REPAY","WITHDRAW","ENTER_MARKET","EXIT_MARKET"];

const ADAPTER_ABI = [
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
  "event EgressInitiated(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, address underlying, uint256 amount, bytes destinationAddress)",
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
  "function marketConfigOf(address) view returns (address underlying, bytes32 tokenId, bool listed)",
  "function payloadHashByIntent(bytes32) view returns (bytes32)",
];
const FACTORY_ABI = ["function proxyOf(bytes32) view returns (address)"];
const CTOKEN_ABI  = [
  "function balanceOf(address) view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
];

async function main() {
  const provider = ethers.provider;
  const latest   = await provider.getBlockNumber();
  const adapter  = new ethers.Contract(ADAPTER, ADAPTER_ABI, provider);
  const factory  = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const cSTST    = new ethers.Contract(SSTST, CTOKEN_ABI, provider);

  console.log("\n══ Borrow Diagnosis for", XRPL_ADDR, "══");
  console.log("  xrplAccount :", XRPL_ACC);
  console.log("  Current block:", latest);

  // 1. Account state
  const nonce  = await adapter.nextNonceByXrplAccount(XRPL_ACC);
  const signer = await adapter.intentSignerOfXrplAccount(XRPL_ACC);
  const proxy  = await factory.proxyOf(XRPL_ACC);
  console.log("\n── Account state ──────────────────────────────────────");
  console.log("  Next nonce   :", nonce.toString());
  console.log("  Signer       :", signer === ethers.ZeroAddress ? "NOT REGISTERED" : signer);
  console.log("  Proxy        :", proxy === ethers.ZeroAddress ? "none" : proxy);

  // 2. sSTST market config
  const cfg = await adapter.marketConfigOf(SSTST);
  console.log("\n── sSTST market config in adapter ────────────────────");
  console.log("  underlying :", cfg.underlying);
  console.log("  tokenId    :", cfg.tokenId);
  console.log("  listed     :", cfg.listed);

  // 3. sSTST market liquidity
  const [cash, totalBorrows] = await Promise.all([cSTST.getCash(), cSTST.totalBorrows()]);
  console.log("\n── sSTST market liquidity ─────────────────────────────");
  console.log("  getCash()      :", ethers.formatEther(cash), "STST");
  console.log("  totalBorrows() :", ethers.formatEther(totalBorrows), "STST");

  // 4. Proxy balances if proxy exists
  if (proxy !== ethers.ZeroAddress) {
    const [cBal, exchRate, borrow] = await Promise.all([
      cSTST.balanceOf(proxy),
      cSTST.exchangeRateStored(),
      cSTST.borrowBalanceStored(proxy),
    ]);
    const underlying = (cBal * exchRate) / ethers.parseEther("1");
    console.log("\n── Proxy sSTST balances ───────────────────────────────");
    console.log("  cSTST balance  :", cBal.toString());
    console.log("  Underlying     :", ethers.formatEther(underlying), "STST");
    console.log("  Borrow         :", ethers.formatEther(borrow), "STST");
  }

  // 5. Scan IntentExecuted + EgressInitiated
  console.log("\n── Event scan from block", SCAN_FROM, "to", latest, "────────");
  const executed:  any[] = [];
  const egresses:  any[] = [];
  for (let s = SCAN_FROM; s <= latest; s += CHUNK) {
    const e = Math.min(s + CHUNK - 1, latest);
    const [ev, eg] = await Promise.all([
      adapter.queryFilter(adapter.filters.IntentExecuted(null, XRPL_ACC), s, e),
      adapter.queryFilter(adapter.filters.EgressInitiated(null, XRPL_ACC), s, e),
    ]);
    executed.push(...ev);
    egresses.push(...eg);
  }

  console.log("\n  IntentExecuted events :", executed.length);
  for (const e of executed) {
    const action = ACTION[Number(e.args.actionType)] ?? "UNKNOWN";
    console.log(`    [block ${e.blockNumber}] nonce implied | ${action} ${ethers.formatEther(e.args.amount)} — market: ${e.args.market} — tx: ${e.transactionHash}`);
  }

  console.log("\n  EgressInitiated events :", egresses.length);
  for (const e of egresses) {
    console.log(`    [block ${e.blockNumber}] underlying: ${e.args.underlying} amount: ${ethers.formatEther(e.args.amount)} — dest: ${e.args.destinationAddress} — tx: ${e.transactionHash}`);
  }

  // 6. Adapter native balance (for egress gas)
  const adapterBal = await provider.getBalance(ADAPTER);
  console.log("\n── Adapter gas balance ────────────────────────────────");
  console.log("  Native XRP :", ethers.formatEther(adapterBal), "XRP");

  // 7. Verdict
  console.log("\n── Verdict ────────────────────────────────────────────");
  if (!cfg.listed) {
    console.log("  ✗ CRITICAL: sSTST market NOT listed in adapter — BORROW would revert");
  } else if (cash === 0n) {
    console.log("  ✗ CRITICAL: sSTST getCash() = 0 — no liquidity to borrow from");
  } else if (executed.length === 0) {
    console.log("  ✗ No IntentExecuted found — BORROW intent never reached EVM execution");
    console.log("    Possible causes:");
    console.log("    - Axelar relay not yet delivered");
    console.log("    - Wrong xrplAccount hash (keccak vs raw bytes)");
    console.log("    - Signature verification failed (wrong signer registered)");
  } else {
    const borrows = executed.filter(e => Number(e.args.actionType) === 1);
    if (borrows.length === 0) {
      console.log("  ✗ IntentExecuted events found but none are BORROW");
    } else if (egresses.length === 0) {
      console.log("  ✗ BORROW executed but no EgressInitiated — egress failed silently");
      console.log("    Check: sSTST tokenId in adapter vs Axelar ITS tokenId");
    } else {
      console.log("  ✓ Both IntentExecuted(BORROW) and EgressInitiated found");
      console.log("    → Check Axelarscan for the tx hash above to see relay status");
    }
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
