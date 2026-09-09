import { ethers } from "hardhat";

const ADAPTER    = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const FACTORY    = "0x3C03CF51E4BFa50B5482165Cc053D71698b780f4";
const XRPL_ADDR  = "rBSKvJNZWwLPUgHR17xjCSWSACQyCsFnCt";
const XRPL_ACC   = ethers.keccak256(ethers.toUtf8Bytes(XRPL_ADDR));
const SCAN_FROM  = 7200000;
const CHUNK      = 5000;
const ACTION     = ["SUPPLY","BORROW","REPAY","WITHDRAW","ENTER_MARKET","EXIT_MARKET"];

const ADAPTER_ABI = [
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
  "event IntentDuplicateIgnored(bytes32 indexed intentId, bytes32 payloadHash)",
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
  "function intentSignerOfXrplAccount(bytes32) view returns (address)",
];
const FACTORY_ABI = ["function proxyOf(bytes32) view returns (address)"];

async function main() {
  const provider = ethers.provider;
  const latest   = await provider.getBlockNumber();
  const adapter  = new ethers.Contract(ADAPTER, ADAPTER_ABI, provider);
  const factory  = new ethers.Contract(FACTORY, FACTORY_ABI, provider);

  const executed: any[] = [];
  const dupes:    any[] = [];
  for (let s = SCAN_FROM; s <= latest; s += CHUNK) {
    const e = Math.min(s + CHUNK - 1, latest);
    const [ev, dv] = await Promise.all([
      adapter.queryFilter(adapter.filters.IntentExecuted(null, XRPL_ACC), s, e),
      adapter.queryFilter(adapter.filters.IntentDuplicateIgnored(), s, e),
    ]);
    executed.push(...ev);
    dupes.push(...dv);
  }

  const nonce  = await adapter.nextNonceByXrplAccount(XRPL_ACC);
  const signer = await adapter.intentSignerOfXrplAccount(XRPL_ACC);
  const proxy  = await factory.proxyOf(XRPL_ACC);

  console.log("\n══ EVM State for", XRPL_ADDR, "══");
  console.log("  xrplAccount (bytes32) :", XRPL_ACC);
  console.log("  Intent signer         :", signer === ethers.ZeroAddress ? "NOT REGISTERED" : signer);
  console.log("  Next nonce            :", nonce.toString());
  console.log("  Proxy                 :", proxy === ethers.ZeroAddress ? "none (never created)" : proxy);
  console.log("  IntentExecuted        :", executed.length);
  console.log("  DuplicateIgnored      :", dupes.length);

  if (executed.length > 0) {
    console.log("\n  Executed intents:");
    for (const e of executed) {
      const action = ACTION[Number(e.args.actionType)] ?? "UNKNOWN";
      console.log(`    [block ${e.blockNumber}] ${action} ${ethers.formatEther(e.args.amount)} XRP — tx: ${e.transactionHash}`);
    }
  } else {
    console.log("\n  ✗  No IntentExecuted events — intents never reached EVM execution.");
  }

  if (signer === ethers.ZeroAddress) {
    console.log("\n  ⚠  ROOT CAUSE: No intent signer registered for this XRPL account.");
    console.log("     The adapter has no session key for rBSKvJNZWwLPUgHR17xjCSWSACQyCsFnCt.");
    console.log("     All intents are rejected at signature verification before execution.");
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
