/**
 * Query ALL IntentExecuted events for our XRPL accounts from adapter deployment.
 * Required env vars: XRPL_EVM_RPC_URL
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

// Scan in chunks to avoid RPC limits
const CHUNK_SIZE = 5000;
// Adapter was deployed recently — start from a known early block
// XRPL EVM testnet current block ~6.9M; adapter likely deployed in last ~50k blocks
const SCAN_FROM_BLOCK = 6800000;

const ADAPTER_ABI = [
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
  "event EgressInitiated(bytes32 indexed intentId, bytes32 indexed xrplAccount, bytes32 indexed tokenId, string destinationChain, bytes destinationAddress, uint256 amount, uint256 gasValue)",
  "event IntentDuplicateIgnored(bytes32 indexed intentId, bytes32 payloadHash)",
  "function nextNonceByXrplAccount(bytes32 xrplAccount) view returns (uint64)",
];

const ACTION_NAMES: Record<number, string> = {
  0: "SUPPLY",
  1: "BORROW",
  2: "REPAY",
  3: "WITHDRAW",
  4: "ENTER_MARKET",
  5: "EXIT_MARKET",
};

const KNOWN_XRPL_ACCOUNTS = [
  { label: "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48", hash: ethers.keccak256(ethers.toUtf8Bytes("r4obbPExFxVcmqUBr5jepsdtDLX3htdq48")) },
  { label: "rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB", hash: ethers.keccak256(ethers.toUtf8Bytes("rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB")) },
];

async function queryInChunks(
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  fromBlock: number,
  toBlock: number
): Promise<ethers.EventLog[]> {
  const results: ethers.EventLog[] = [];
  for (let from = fromBlock; from <= toBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, toBlock);
    const events = await contract.queryFilter(filter, from, to) as ethers.EventLog[];
    results.push(...events);
    if (events.length > 0) {
      process.stdout.write(`  found ${events.length} event(s) in blocks ${from}-${to}\n`);
    }
  }
  return results;
}

async function main() {
  const dep      = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const provider = ethers.provider;
  const adapter  = new ethers.Contract(dep.xrplBridgeAdapter, ADAPTER_ABI, provider);

  const latestBlock = await provider.getBlockNumber();
  console.log(`Adapter  : ${dep.xrplBridgeAdapter}`);
  console.log(`Scanning : blocks ${SCAN_FROM_BLOCK} → ${latestBlock}\n`);

  // ── Current nonces ─────────────────────────────────────────────────────────
  console.log("── Current nonces ──");
  for (const acc of KNOWN_XRPL_ACCOUNTS) {
    const nonce = await adapter.nextNonceByXrplAccount(acc.hash);
    console.log(`  ${acc.label}: nonce=${nonce}  (hash: ${acc.hash})`);
  }
  console.log();

  // ── IntentExecuted — all ──────────────────────────────────────────────────
  console.log("Scanning IntentExecuted events...");
  const executed = await queryInChunks(adapter, adapter.filters.IntentExecuted(), SCAN_FROM_BLOCK, latestBlock);
  console.log(`\nTotal IntentExecuted: ${executed.length}\n`);

  for (const e of executed) {
    const { intentId, xrplAccount, proxy, actionType, market, underlying, amount, tokenFlow } = e.args;
    const label = KNOWN_XRPL_ACCOUNTS.find(a => a.hash.toLowerCase() === xrplAccount.toLowerCase())?.label ?? "UNKNOWN";
    console.log(`  [block ${e.blockNumber}] TX ${e.transactionHash}`);
    console.log(`    xrplAccount : ${label} (${xrplAccount})`);
    console.log(`    proxy       : ${proxy}`);
    console.log(`    action      : ${ACTION_NAMES[Number(actionType)] ?? actionType}`);
    console.log(`    amount      : ${ethers.formatEther(amount)} (${amount.toString()})`);
    console.log(`    tokenFlow   : ${tokenFlow}`);
    console.log();
  }

  // ── EgressInitiated — all ─────────────────────────────────────────────────
  console.log("Scanning EgressInitiated events...");
  const egress = await queryInChunks(adapter, adapter.filters.EgressInitiated(), SCAN_FROM_BLOCK, latestBlock);
  console.log(`\nTotal EgressInitiated: ${egress.length}\n`);
  for (const e of egress) {
    const { intentId, xrplAccount, tokenId, destinationChain, destinationAddress, amount, gasValue } = e.args;
    const label = KNOWN_XRPL_ACCOUNTS.find(a => a.hash.toLowerCase() === xrplAccount.toLowerCase())?.label ?? "UNKNOWN";
    console.log(`  [block ${e.blockNumber}] TX ${e.transactionHash}`);
    console.log(`    xrplAccount : ${label}`);
    console.log(`    destination : ${destinationChain} / ${ethers.toUtf8String(destinationAddress)}`);
    console.log(`    amount      : ${ethers.formatEther(amount)}`);
    console.log(`    gasValue    : ${gasValue}`);
    console.log();
  }

  // ── IntentDuplicateIgnored ─────────────────────────────────────────────────
  console.log("Scanning IntentDuplicateIgnored events...");
  const dupes = await queryInChunks(adapter, adapter.filters.IntentDuplicateIgnored(), SCAN_FROM_BLOCK, latestBlock);
  console.log(`\nTotal IntentDuplicateIgnored: ${dupes.length}`);
  for (const e of dupes) {
    const { intentId, payloadHash } = e.args;
    console.log(`  [block ${e.blockNumber}] TX ${e.transactionHash}`);
    console.log(`    intentId: ${intentId}`);
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
