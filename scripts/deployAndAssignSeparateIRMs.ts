/**
 * Deploys two separate JumpRateModelV2 instances and assigns each to its market:
 *
 *   sXRP  → XRP-curve   (volatile asset: higher slope, 75% kink)
 *   sSTST → STST-curve  (stablecoin-like: low slope, 90% kink)
 *
 * Why: both markets previously shared one IRM deployed with all-zero params (APY = 0).
 * Separating them allows each market to have an independent risk curve and avoids
 * coupling — a future IRM parameter change for one market won't affect the other.
 *
 * Caller must be the cToken admin (deployer: 0x243CD17C18052dD49B803dB5be3c2907DA6ff783).
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

// ─── Target parameters ───────────────────────────────────────────────────────
//
// sXRP: volatile asset — mimics Compound v2 ETH market curve
//   Base rate   :  2%   (borrowers pay at least 2% even with no utilization)
//   Multiplier  : 15%   (slope below kink)
//   Jump mult   : 200%  (steep slope above kink to disincentivize draining)
//   Kink        : 75%   (tighter than stablecoins, reflecting volatility risk)
//
const XRP_BASE_RATE         = ethers.parseEther("0.02");   // 2%
const XRP_MULTIPLIER        = ethers.parseEther("0.15");   // 15%
const XRP_JUMP_MULTIPLIER   = ethers.parseEther("2.00");   // 200%
const XRP_KINK              = ethers.parseEther("0.75");   // 75%

// sSTST: stablecoin-like — mimics Compound v2 USDC/DAI curve
//   Base rate   :  0%   (no floor — only pays when utilized)
//   Multiplier  :  4%   (very flat slope below kink)
//   Jump mult   : 100%  (strong incentive to repay if above kink)
//   Kink        : 90%   (stablecoins tolerate high utilization)
//
const STST_BASE_RATE        = 0n;                          // 0%
const STST_MULTIPLIER       = ethers.parseEther("0.04");   // 4%
const STST_JUMP_MULTIPLIER  = ethers.parseEther("1.00");   // 100%
const STST_KINK             = ethers.parseEther("0.90");   // 90%

// ─── ABIs ────────────────────────────────────────────────────────────────────
const CTOKEN_ABI = [
  "function symbol() view returns (string)",
  "function admin() view returns (address)",
  "function interestRateModel() view returns (address)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function _setInterestRateModel(address newInterestRateModel) returns (uint256)",
];
const IRM_ABI = [
  "function owner() view returns (address)",
  "function blocksPerYear() view returns (uint256)",
  "function baseRatePerBlock() view returns (uint256)",
  "function multiplierPerBlock() view returns (uint256)",
  "function jumpMultiplierPerBlock() view returns (uint256)",
  "function kink() view returns (uint256)",
];

const BLOCKS_PER_YEAR = 9_014_400n;
const ONE = ethers.parseEther("1");

function toAPY(ratePerBlock: bigint): string {
  return (Number(ratePerBlock * BLOCKS_PER_YEAR * 100n) / Number(ONE)).toFixed(4) + "%";
}

async function printMarketRates(label: string, cToken: ethers.Contract) {
  const [supplyRate, borrowRate, cash, borrows] = await Promise.all([
    cToken.supplyRatePerBlock(),
    cToken.borrowRatePerBlock(),
    cToken.getCash(),
    cToken.totalBorrows(),
  ]);
  const util = cash + borrows === 0n ? 0 : Number(borrows * 10000n / (cash + borrows)) / 100;
  console.log(`  ${label}: Supply ${toAPY(supplyRate)}  Borrow ${toAPY(borrowRate)}  (util ${util.toFixed(1)}%)`);
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const sXRP  = dep.markets.find((m: any) => m.cTokenSymbol === "sXRP");
  const sSTST = dep.markets.find((m: any) => m.cTokenSymbol === "sSTST");
  if (!sXRP || !sSTST) throw new Error("Markets not found in deployment file");

  const [signer] = await ethers.getSigners();
  console.log("Signer :", signer.address);
  console.log("sXRP   :", sXRP.cToken);
  console.log("sSTST  :", sSTST.cToken);

  const cXRP  = new ethers.Contract(sXRP.cToken,  CTOKEN_ABI, signer);
  const cSTST = new ethers.Contract(sSTST.cToken, CTOKEN_ABI, signer);

  // Verify caller is admin on both cTokens
  const [adminXRP, adminSTST] = await Promise.all([cXRP.admin(), cSTST.admin()]);
  if (adminXRP.toLowerCase()  !== signer.address.toLowerCase()) throw new Error(`Not admin on sXRP  (admin=${adminXRP})`);
  if (adminSTST.toLowerCase() !== signer.address.toLowerCase()) throw new Error(`Not admin on sSTST (admin=${adminSTST})`);
  console.log("\nAdmin check passed.");

  // Print current APYs
  console.log("\n=== BEFORE ===");
  await printMarketRates("sXRP ", cXRP);
  await printMarketRates("sSTST", cSTST);

  // ── 1. Deploy IRM for sXRP ─────────────────────────────────────────────────
  console.log("\n--- Deploying IRM for sXRP ---");
  console.log("  Base rate   :", ethers.formatEther(XRP_BASE_RATE), "(2%)");
  console.log("  Multiplier  :", ethers.formatEther(XRP_MULTIPLIER), "(15%)");
  console.log("  Jump mult   :", ethers.formatEther(XRP_JUMP_MULTIPLIER), "(200%)");
  console.log("  Kink        :", ethers.formatEther(XRP_KINK), "(75%)");

  const JumpRateModel = await ethers.getContractFactory("JumpRateModelV2");
  const irmXRP = await JumpRateModel.deploy(
    XRP_BASE_RATE, XRP_MULTIPLIER, XRP_JUMP_MULTIPLIER, XRP_KINK,
    signer.address,
  );
  await irmXRP.waitForDeployment();
  const irmXRPAddr = await irmXRP.getAddress();
  console.log("  Deployed at :", irmXRPAddr);

  // ── 2. Deploy IRM for sSTST ────────────────────────────────────────────────
  console.log("\n--- Deploying IRM for sSTST ---");
  console.log("  Base rate   :", ethers.formatEther(STST_BASE_RATE), "(0%)");
  console.log("  Multiplier  :", ethers.formatEther(STST_MULTIPLIER), "(4%)");
  console.log("  Jump mult   :", ethers.formatEther(STST_JUMP_MULTIPLIER), "(100%)");
  console.log("  Kink        :", ethers.formatEther(STST_KINK), "(90%)");

  const irmSTST = await JumpRateModel.deploy(
    STST_BASE_RATE, STST_MULTIPLIER, STST_JUMP_MULTIPLIER, STST_KINK,
    signer.address,
  );
  await irmSTST.waitForDeployment();
  const irmSTSTAddr = await irmSTST.getAddress();
  console.log("  Deployed at :", irmSTSTAddr);

  // ── 3. Assign new IRM to sXRP ──────────────────────────────────────────────
  console.log("\n--- Assigning IRM to sXRP ---");
  const tx1 = await cXRP._setInterestRateModel(irmXRPAddr);
  const r1   = await tx1.wait();
  console.log("  TX:", r1.hash, "block:", r1.blockNumber);
  const newIrmXRP = await cXRP.interestRateModel();
  if (newIrmXRP.toLowerCase() !== irmXRPAddr.toLowerCase())
    throw new Error("IRM assignment failed for sXRP");
  console.log("  Confirmed — sXRP IRM:", newIrmXRP);

  // ── 4. Assign new IRM to sSTST ─────────────────────────────────────────────
  console.log("\n--- Assigning IRM to sSTST ---");
  const tx2 = await cSTST._setInterestRateModel(irmSTSTAddr);
  const r2   = await tx2.wait();
  console.log("  TX:", r2.hash, "block:", r2.blockNumber);
  const newIrmSTST = await cSTST.interestRateModel();
  if (newIrmSTST.toLowerCase() !== irmSTSTAddr.toLowerCase())
    throw new Error("IRM assignment failed for sSTST");
  console.log("  Confirmed — sSTST IRM:", newIrmSTST);

  // ── 5. Print new APYs ──────────────────────────────────────────────────────
  console.log("\n=== AFTER ===");
  await printMarketRates("sXRP ", cXRP);
  await printMarketRates("sSTST", cSTST);

  // ── 6. Persist to deployment file ─────────────────────────────────────────
  sXRP.interestRateModel  = irmXRPAddr;
  sSTST.interestRateModel = irmSTSTAddr;
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(dep, null, 2));
  console.log("\nDeployment file updated.");
  console.log("\nDone. sXRP and sSTST now have independent interest rate models.");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
