import { ethers } from "hardhat";

const ADAPTER_ADDR = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const XRPL_ADDRESS = "rPpamGtvayxx97LcxM7dWhBSJsPCzdUCAB";
const XRPL_ACCOUNT = "0xb2e98690a6e04b7f2eff91e0ca615122753fd8ae6e62eeeafe7c88169e9b7a09";
const SCAN_FROM    = 6800000;

const ADAPTER_ABI = [
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
  "event EgressInitiated(bytes32 indexed intentId, bytes32 indexed xrplAccount, bytes32 indexed tokenId, string destinationChain, bytes destinationAddress, uint256 amount, uint256 gasValue)",
  "event IntentDuplicateIgnored(bytes32 indexed intentId, bytes32 indexed xrplAccount)",
];

const ACTION = ["SUPPLY", "BORROW", "REPAY", "WITHDRAW", "ENTER_MARKET", "EXIT_MARKET"];
const CHUNK  = 5000;

async function queryChunks(adapter: ethers.Contract, filter: any, from: number, to: number) {
  const events: any[] = [];
  for (let s = from; s <= to; s += CHUNK) {
    const e = Math.min(s + CHUNK - 1, to);
    const chunk = await adapter.queryFilter(filter, s, e);
    events.push(...chunk);
  }
  return events;
}

async function main() {
  const provider  = ethers.provider;
  const latest    = await provider.getBlockNumber();
  const adapter   = new ethers.Contract(ADAPTER_ADDR, ADAPTER_ABI, provider);

  const [executed, egress, duplicates] = await Promise.all([
    queryChunks(adapter, adapter.filters.IntentExecuted(null, XRPL_ACCOUNT), SCAN_FROM, latest),
    queryChunks(adapter, adapter.filters.EgressInitiated(null, XRPL_ACCOUNT), SCAN_FROM, latest),
    queryChunks(adapter, adapter.filters.IntentDuplicateIgnored(null, XRPL_ACCOUNT), SCAN_FROM, latest),
  ]);

  const egressMap = new Map(egress.map((e: any) => [e.args.intentId, e]));

  console.log("\n" + "═".repeat(68));
  console.log(` Securd — Full History for ${XRPL_ADDRESS}`);
  console.log("═".repeat(68));
  console.log(` Successful intents  : ${executed.length}`);
  console.log(` Egress (XRP out)    : ${egress.length}`);
  console.log(` Duplicate ignored   : ${duplicates.length}`);

  console.log("\n── Successful Transactions ──────────────────────────────────\n");

  for (let i = 0; i < executed.length; i++) {
    const e    = executed[i];
    const { intentId, proxy, actionType, amount, tokenFlow } = e.args;
    const action  = ACTION[Number(actionType)] ?? `ACTION_${actionType}`;
    const amtXrp  = ethers.formatEther(amount);
    const eg      = egressMap.get(intentId);

    console.log(`  #${i + 1}  [block ${e.blockNumber}]  ${action}`);
    console.log(`       amount   : ${amtXrp} XRP`);
    console.log(`       flow     : ${tokenFlow ? "ITS in (token bridged in)" : "GMP (no token in)"}`);
    console.log(`       proxy    : ${proxy}`);
    console.log(`       evm tx   : ${e.transactionHash}`);
    if (eg) {
      const dest = ethers.toUtf8String(eg.args.destinationAddress);
      console.log(`       egress   : ✓  ${ethers.formatEther(eg.args.amount)} XRP → ${dest}`);
    }
    console.log();
  }

  if (duplicates.length > 0) {
    console.log("── Failed / Duplicate Intents ───────────────────────────────\n");
    for (const d of duplicates) {
      console.log(`  [block ${d.blockNumber}]  intentId: ${d.args.intentId}`);
      console.log(`  evm tx  : ${d.transactionHash}`);
      console.log();
    }
  } else {
    console.log("── Failed / Duplicate Intents ───────────────────────────────");
    console.log("  None detected via on-chain events.\n");
  }

  // Current proxy state
  const CTOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function borrowBalanceCurrent(address) returns (uint256)",
    "function exchangeRateStored() view returns (uint256)",
  ];
  const COMPTROLLER_ABI = [
    "function checkMembership(address, address) view returns (bool)",
    "function getAccountLiquidity(address) view returns (uint256,uint256,uint256)",
  ];
  const proxyAddr  = executed.length > 0 ? executed[0].args.proxy : null;
  const cXRP       = "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318";
  const unitroller = "0x46d364257112230022E72b086Df85a6b0f8D3F86";

  if (proxyAddr) {
    const cToken      = new ethers.Contract(cXRP, CTOKEN_ABI, provider);
    const comptroller = new ethers.Contract(unitroller, COMPTROLLER_ABI, provider);
    const [cBal, exchRate, isMember, liq] = await Promise.all([
      cToken.balanceOf(proxyAddr),
      cToken.exchangeRateStored(),
      comptroller.checkMembership(proxyAddr, cXRP),
      comptroller.getAccountLiquidity(proxyAddr),
    ]);
    const underlying = (cBal * exchRate) / ethers.parseEther("1");

    console.log("── Current Proxy State (XRPL EVM) ───────────────────────────");
    console.log(`  proxy            : ${proxyAddr}`);
    console.log(`  XRP supplied     : ${ethers.formatEther(underlying)} XRP`);
    console.log(`  Collateral on    : ${isMember}`);
    console.log(`  Liquidity        : ${ethers.formatEther(liq[1])} USD`);
    console.log(`  Shortfall        : ${ethers.formatEther(liq[2])} USD`);
    console.log();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
