import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

const ADAPTER_ABI = [
  "function egressGasValue() view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const adapterAddr: string = dep.xrplBridgeAdapter;

  const adapter = new ethers.Contract(adapterAddr, ADAPTER_ABI, ethers.provider);

  const [balance, egressGas, owner] = await Promise.all([
    ethers.provider.getBalance(adapterAddr),
    adapter.egressGasValue(),
    adapter.owner(),
  ]);

  const opsRemaining = egressGas > 0n ? balance / egressGas : BigInt("999999");
  const LOW_THRESHOLD = 5n;

  console.log("\n" + "═".repeat(60));
  console.log("  Adapter Fund Check");
  console.log("═".repeat(60));
  console.log(`  Adapter address   : ${adapterAddr}`);
  console.log(`  Owner             : ${owner}`);
  console.log(`  Native XRP balance: ${ethers.formatEther(balance)} XRP`);
  console.log(`  Egress gas value  : ${ethers.formatEther(egressGas)} XRP  (per BORROW/WITHDRAW)`);
  console.log(`  Ops remaining     : ${opsRemaining}`);

  if (opsRemaining < LOW_THRESHOLD) {
    console.log("\n  ⚠️  WARNING: adapter is running low on funds!");
    console.log(`     Top up with: npx hardhat run scripts/fundAdapter.ts --network xrplEvm`);
  } else {
    console.log("\n  ✓  Adapter is adequately funded.");
  }

  console.log("═".repeat(60) + "\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
