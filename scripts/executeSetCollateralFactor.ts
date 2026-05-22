/**
 * Executes the pending _setCollateralFactor(sSTST, 70%) action from the
 * CollateralFactorTimelock. The actionId and eta were saved to the deployment
 * file by timelockSupportStsTMarket.ts. The 48h delay must have elapsed.
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

const TIMELOCK_ABI = [
  "function execute(bytes32 actionId) external",
  "function queuedActions(bytes32) view returns (address target, uint256 value, bytes data, uint256 eta, bool exists)",
];
const COMPTROLLER_ABI = [
  "function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
];

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const stst = dep.markets.find((m: any) => m.cTokenSymbol === "sSTST");
  if (!stst) throw new Error("sSTST market not found in deployment file");
  if (!dep.pendingCFActionId) throw new Error("No pendingCFActionId in deployment file — already executed?");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Timelock:", dep.collateralFactorTimelock);
  console.log("cSTST:", stst.cToken);
  console.log("ActionId:", dep.pendingCFActionId);

  const timelock    = new ethers.Contract(dep.collateralFactorTimelock, TIMELOCK_ABI, signer);
  const comptroller = new ethers.Contract(dep.unitroller, COMPTROLLER_ABI, signer);

  const action = await timelock.queuedActions(dep.pendingCFActionId);
  if (!action.exists) throw new Error("Action not found in timelock — already executed or wrong actionId");

  const eta = Number(action.eta);
  const now = Math.floor(Date.now() / 1000);
  console.log("\nETA:", new Date(eta * 1000).toISOString());
  console.log("Now:", new Date(now * 1000).toISOString());
  if (now < eta) throw new Error(`Too early — ${eta - now}s remaining until ETA`);

  const marketBefore = await comptroller.markets(stst.cToken);
  console.log("\nCF before:", ethers.formatEther(marketBefore.collateralFactorMantissa));

  console.log("\nExecuting _setCollateralFactor(sSTST, 70%)...");
  const tx = await timelock.execute(dep.pendingCFActionId);
  const receipt = await tx.wait();
  console.log("TX:", receipt.hash);

  const marketAfter = await comptroller.markets(stst.cToken);
  console.log("CF after:", ethers.formatEther(marketAfter.collateralFactorMantissa));

  delete dep.pendingCFActionId;
  delete dep.pendingCFEta;
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(dep, null, 2));
  console.log("\nDone. Deployment file updated.");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
