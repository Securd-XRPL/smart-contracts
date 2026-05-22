import { ethers } from "hardhat";

const IRM_ABI = [
  "function blocksPerYear() view returns (uint256)",
  "function baseRatePerBlock() view returns (uint256)",
  "function multiplierPerBlock() view returns (uint256)",
  "function jumpMultiplierPerBlock() view returns (uint256)",
  "function kink() view returns (uint256)",
];
const CTOKEN_ABI = [
  "function interestRateModel() view returns (address)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function symbol() view returns (string)",
];
const MARKETS = [
  "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318",
  "0x2F874D87E685EC28be749B781dc99119F27CF0be",
];

async function main() {
  const provider = ethers.provider;
  const ONE = ethers.parseEther("1");

  for (const addr of MARKETS) {
    const ct = new ethers.Contract(addr, CTOKEN_ABI, provider);
    const [sym, irmAddr, supplyRate, borrowRate] = await Promise.all([
      ct.symbol(), ct.interestRateModel(),
      ct.supplyRatePerBlock(), ct.borrowRatePerBlock(),
    ]);
    const irm = new ethers.Contract(irmAddr, IRM_ABI, provider);
    const [bpy, base, mult, jump, kink] = await Promise.all([
      irm.blocksPerYear(), irm.baseRatePerBlock(),
      irm.multiplierPerBlock(), irm.jumpMultiplierPerBlock(), irm.kink(),
    ]);

    const baseAPY      = Number(base * bpy * 100n) / Number(ONE) / 1e18;
    const supplyAPY    = Number(supplyRate * bpy * 100n) / Number(ONE) / 1e18;
    const borrowAPY    = Number(borrowRate * bpy * 100n) / Number(ONE) / 1e18;

    console.log(`\n${"═".repeat(60)}`);
    console.log(` ${sym}  —  IRM: ${irmAddr}`);
    console.log(`${"═".repeat(60)}`);
    console.log(`  blocksPerYear         : ${bpy}`);
    console.log(`  baseRatePerBlock      : ${base}`);
    console.log(`  multiplierPerBlock    : ${mult}`);
    console.log(`  jumpMultiplierPerBlock: ${jump}`);
    console.log(`  kink                  : ${(Number(ethers.formatEther(kink)) * 100).toFixed(0)}%`);
    console.log(`  ──────────────────────────────────────`);
    console.log(`  base APY (at 0% util) : ${baseAPY.toFixed(4)}%`);
    console.log(`  supplyRatePerBlock    : ${supplyRate}  →  supply APY: ${supplyAPY.toFixed(4)}%`);
    console.log(`  borrowRatePerBlock    : ${borrowRate}  →  borrow APY: ${borrowAPY.toFixed(4)}%`);
    console.log(`  ──────────────────────────────────────`);
    if (base === 0n) {
      console.log(`  ⚠  baseRatePerBlock = 0 → borrow APY will be 0% at zero utilization`);
    }
    if (bpy === 0n) {
      console.log(`  ⚠  blocksPerYear = 0 → APY formula always returns 0`);
    }
  }
}

main().catch(console.error);
