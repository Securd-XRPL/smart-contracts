/**
 * Fixes APY = 0 on both sXRP and sSTST by setting real interest rate parameters
 * on the shared JumpRateModelV2 instance.
 *
 * Both markets share IRM at: 0xDd31C1db90AB0b094d73E0b4c8dae2296a7d8C0d
 * Owner (can call updateJumpRateModel): 0x243CD17C18052dD49B803dB5be3c2907DA6ff783
 *
 * Target curve (same as Compound v2 DAI):
 *   Base rate   :  2%   per year
 *   Multiplier  : 10%   per year (slope below kink)
 *   JumpMultiplier: 109% per year (slope above kink)
 *   Kink        : 80%  utilization
 *
 * Expected APY after fix (at 80% utilization):
 *   Borrow APY : ~12.75%
 *   Supply APY :  ~9.0%  (at 80% util, assuming 10% reserve factor)
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";

const IRM_ADDRESS = "0xDd31C1db90AB0b094d73E0b4c8dae2296a7d8C0d";

const IRM_ABI = [
  "function owner() view returns (address)",
  "function blocksPerYear() view returns (uint256)",
  "function baseRatePerBlock() view returns (uint256)",
  "function multiplierPerBlock() view returns (uint256)",
  "function jumpMultiplierPerBlock() view returns (uint256)",
  "function kink() view returns (uint256)",
  "function updateJumpRateModel(uint256 baseRatePerYear, uint256 multiplierPerYear, uint256 jumpMultiplierPerYear, uint256 kink_) external",
  "function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) view returns (uint256)",
  "event NewInterestParams(uint baseRatePerBlock, uint multiplierPerBlock, uint jumpMultiplierPerBlock, uint kink)",
];

const CTOKEN_ABI = [
  "function symbol() view returns (string)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
];

const BLOCKS_PER_YEAR = 9_014_400n;
const ONE = ethers.parseEther("1");

const MARKETS = [
  { symbol: "sXRP",  address: "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318" },
  { symbol: "sSTST", address: "0x2F874D87E685EC28be749B781dc99119F27CF0be" },
];

// Target parameters (18-decimal mantissas, per year)
const BASE_RATE_PER_YEAR        = 20_000_000_000_000_000n;   // 2%
const MULTIPLIER_PER_YEAR       = 100_000_000_000_000_000n;  // 10%
const JUMP_MULTIPLIER_PER_YEAR  = 1_090_000_000_000_000_000n; // 109%
const KINK                      = 800_000_000_000_000_000n;  // 80%

function toAPY(ratePerBlock: bigint): string {
  return (Number(ratePerBlock * BLOCKS_PER_YEAR * 100n) / Number(ONE)).toFixed(4) + "%";
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer  :", signer.address);
  console.log("IRM     :", IRM_ADDRESS);

  const irm = new ethers.Contract(IRM_ADDRESS, IRM_ABI, signer);

  const owner = await irm.owner();
  console.log("IRM owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not the IRM owner (${owner})`);
  }

  // --- Read current state ---
  console.log("\n=== BEFORE ===");
  const [baseRateBefore, multBefore, jumpBefore, kinkBefore] = await Promise.all([
    irm.baseRatePerBlock(),
    irm.multiplierPerBlock(),
    irm.jumpMultiplierPerBlock(),
    irm.kink(),
  ]);
  console.log("baseRatePerBlock     :", baseRateBefore.toString(), "→ APY", toAPY(baseRateBefore));
  console.log("multiplierPerBlock   :", multBefore.toString());
  console.log("jumpMultiplierPerBlock:", jumpBefore.toString());
  console.log("kink                 :", ethers.formatEther(kinkBefore));

  for (const { symbol, address } of MARKETS) {
    const ct = new ethers.Contract(address, CTOKEN_ABI, signer);
    const [supplyRate, borrowRate] = await Promise.all([ct.supplyRatePerBlock(), ct.borrowRatePerBlock()]);
    console.log(`\n${symbol}`);
    console.log("  Supply APY:", toAPY(supplyRate), " | Borrow APY:", toAPY(borrowRate));
  }

  // --- Apply fix ---
  console.log("\n=== Applying updateJumpRateModel ===");
  console.log("baseRatePerYear      :", ethers.formatEther(BASE_RATE_PER_YEAR), "(2%)");
  console.log("multiplierPerYear    :", ethers.formatEther(MULTIPLIER_PER_YEAR), "(10%)");
  console.log("jumpMultiplierPerYear:", ethers.formatEther(JUMP_MULTIPLIER_PER_YEAR), "(109%)");
  console.log("kink                 :", ethers.formatEther(KINK), "(80%)");

  const tx = await irm.updateJumpRateModel(
    BASE_RATE_PER_YEAR,
    MULTIPLIER_PER_YEAR,
    JUMP_MULTIPLIER_PER_YEAR,
    KINK,
  );
  console.log("\nTX:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // --- Read state after ---
  console.log("\n=== AFTER ===");
  const [baseRateAfter, multAfter, jumpAfter, kinkAfter] = await Promise.all([
    irm.baseRatePerBlock(),
    irm.multiplierPerBlock(),
    irm.jumpMultiplierPerBlock(),
    irm.kink(),
  ]);
  console.log("baseRatePerBlock     :", baseRateAfter.toString(), "→ APY", toAPY(baseRateAfter));
  console.log("multiplierPerBlock   :", multAfter.toString());
  console.log("jumpMultiplierPerBlock:", jumpAfter.toString());
  console.log("kink                 :", ethers.formatEther(kinkAfter));

  for (const { symbol, address } of MARKETS) {
    const ct = new ethers.Contract(address, CTOKEN_ABI, signer);
    const [supplyRate, borrowRate, cash, borrows, reserves] = await Promise.all([
      ct.supplyRatePerBlock(),
      ct.borrowRatePerBlock(),
      ct.getCash(),
      ct.totalBorrows(),
      ct.totalReserves(),
    ]);
    const util = borrows === 0n ? 0 : Number(borrows * 10000n / (cash + borrows)) / 100;
    console.log(`\n${symbol} (utilization ${util.toFixed(2)}%)`);
    console.log("  Supply APY:", toAPY(supplyRate), " | Borrow APY:", toAPY(borrowRate));
  }

  console.log("\nDone — APY fix applied to both sXRP and sSTST.");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
