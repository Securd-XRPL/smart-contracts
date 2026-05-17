/**
 * Uses the CollateralFactorTimelock to:
 *   1. Queue + immediately execute _supportMarket(cSTST)
 *   2. Queue _setCollateralFactor(cSTST, 70%) with 48h delay (run executeSetCF.ts after 48h)
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

const TIMELOCK_ABI = [
  "function queue(address target, uint256 value, bytes data, uint256 delay) returns (bytes32)",
  "function execute(bytes32 actionId) external",
  "function queuedActions(bytes32) view returns (address target, uint256 value, bytes data, uint256 eta, bool exists)",
];
const COMPTROLLER_ABI = [
  "function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
];

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const stst_market = dep.markets.find((m: any) => m.cTokenSymbol === "sSTST");
  if (!stst_market) throw new Error("sSTST market not in deployment file");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Timelock:", dep.collateralFactorTimelock);
  console.log("cSTST:", stst_market.cToken);

  const timelock    = new ethers.Contract(dep.collateralFactorTimelock, TIMELOCK_ABI, signer);
  const comptroller = new ethers.Contract(dep.unitroller, COMPTROLLER_ABI, signer);

  // ── 1. _supportMarket — delay=0 (no minimum for non-CF calls) ─────────────
  const supportData = new ethers.Interface(["function _supportMarket(address cToken) returns (uint256)"])
    .encodeFunctionData("_supportMarket", [stst_market.cToken]);

  console.log("\nQueuing _supportMarket (delay=0)...");
  const queueTx1 = await timelock.queue(dep.unitroller, 0n, supportData, 0n);
  const queueReceipt1 = await queueTx1.wait();

  // Compute actionId the same way the contract does: keccak256(abi.encode(target, value, data, eta))
  // eta = block.timestamp + delay = block.timestamp + 0 = block.timestamp
  const block1 = await ethers.provider.getBlock(queueReceipt1.blockNumber);
  const eta1 = BigInt(block1!.timestamp);
  const actionId1 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes", "uint256"],
      [dep.unitroller, 0n, supportData, eta1]
    )
  );
  console.log("Queued. actionId:", actionId1);

  console.log("Executing _supportMarket immediately...");
  const execTx1 = await timelock.execute(actionId1);
  await execTx1.wait();
  console.log("Executed. TX:", execTx1.hash);

  const market = await comptroller.markets(stst_market.cToken);
  console.log("Market listed:", market.isListed);

  // ── 2. _setCollateralFactor — requires MIN_DELAY = 48h ───────────────────
  const CF_70 = ethers.parseEther("0.70");
  const MIN_DELAY = 48 * 3600;

  const setCFData = new ethers.Interface(["function _setCollateralFactor(address cToken, uint256 newCollateralFactorMantissa) returns (uint256)"])
    .encodeFunctionData("_setCollateralFactor", [stst_market.cToken, CF_70]);

  console.log("\nQueuing _setCollateralFactor 70% (delay=48h)...");
  const queueTx2 = await timelock.queue(dep.unitroller, 0n, setCFData, BigInt(MIN_DELAY));
  const queueReceipt2 = await queueTx2.wait();

  const block2 = await ethers.provider.getBlock(queueReceipt2.blockNumber);
  const eta = block2!.timestamp + MIN_DELAY;
  const actionId2 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes", "uint256"],
      [dep.unitroller, 0n, setCFData, BigInt(eta)]
    )
  );
  console.log("Queued. actionId:", actionId2);
  console.log("Executable after:", new Date(eta * 1000).toISOString());
  console.log("\nRun executeSetCollateralFactor.ts after 48h with:");
  console.log("  ACTION_ID=" + actionId2);

  // Save actionId for later
  dep.pendingCFActionId = actionId2;
  dep.pendingCFEta = eta;
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(dep, null, 2));
  console.log("\nActionId saved to deployment file.");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
