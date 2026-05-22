/**
 * Checks whether the user proxy can withdraw all supplied XRP.
 * Verifies: outstanding borrows, market liquidity, and adapter redeem path.
 *
 * Run: npx hardhat run scripts/checkWithdrawAll.ts --network xrplEvm
 */
import { ethers } from "hardhat";

const PROXY      = "0xb29dfa70ceDDbe8627Bf719CAA7B1d2ef3642820";
const CXRP       = "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318";
const UNITROLLER = "0x46d364257112230022E72b086Df85a6b0f8D3F86";

const CTOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
];
const COMPTROLLER_ABI = [
  "function checkMembership(address, address) view returns (bool)",
  "function getAccountLiquidity(address) view returns (uint256,uint256,uint256)",
];

async function main() {
  const provider    = ethers.provider;
  const cToken      = new ethers.Contract(CXRP, CTOKEN_ABI, provider);
  const comptroller = new ethers.Contract(UNITROLLER, COMPTROLLER_ABI, provider);

  const [cBal, borrowStored, exchRate, isMember, liq, cash, totalBorrows] = await Promise.all([
    cToken.balanceOf(PROXY),
    cToken.borrowBalanceStored(PROXY),
    cToken.exchangeRateStored(),
    comptroller.checkMembership(PROXY, CXRP),
    comptroller.getAccountLiquidity(PROXY),
    cToken.getCash(),
    cToken.totalBorrows(),
  ]);

  const ONE        = ethers.parseEther("1");
  const underlying = (cBal * exchRate) / ONE;
  const utilPct    = (cash + totalBorrows) > 0n
    ? Number((totalBorrows * 10000n) / (cash + totalBorrows)) / 100
    : 0;

  console.log("\n" + "═".repeat(66));
  console.log("  Withdraw-All Feasibility Check");
  console.log("═".repeat(66));

  console.log("\n── Proxy State ─────────────────────────────────────────────");
  console.log(`  Proxy address        : ${PROXY}`);
  console.log(`  cXRP balance         : ${cBal.toString()} cXRP`);
  console.log(`  Underlying XRP       : ${ethers.formatEther(underlying)} XRP`);
  console.log(`  Borrow balance       : ${ethers.formatEther(borrowStored)} XRP`);
  console.log(`  Collateral member    : ${isMember}`);
  console.log(`  Account liquidity    : ${ethers.formatEther(liq[1])} USD`);
  console.log(`  Account shortfall    : ${ethers.formatEther(liq[2])} USD`);

  console.log("\n── Market Liquidity ─────────────────────────────────────────");
  console.log(`  Available cash       : ${ethers.formatEther(cash)} XRP`);
  console.log(`  Total borrows        : ${ethers.formatEther(totalBorrows)} XRP`);
  console.log(`  Utilization          : ${utilPct.toFixed(2)}%`);

  console.log("\n── Adapter Redeem Path ──────────────────────────────────────");
  console.log("  Adapter calls redeemUnderlying(amount) — NOT redeem(cTokenBalance).");
  console.log("  User must supply exact underlying XRP amount in the intent envelope.");
  console.log("  Exchange rate accrues every block; if amount < actual underlying,");
  console.log("  the difference stays as dust cTokens in the proxy.");
  console.log(`  Current exchange rate: ${exchRate.toString()}`);
  console.log(`  Underlying computed  : ${ethers.formatEther(underlying)} XRP`);

  console.log("\n── Verdict ──────────────────────────────────────────────────");

  const issues: string[] = [];

  if (borrowStored > 0n) {
    issues.push(`Outstanding borrow: ${ethers.formatEther(borrowStored)} XRP must be repaid first`);
  }
  if (cash < underlying) {
    issues.push(`Market only has ${ethers.formatEther(cash)} XRP cash — less than proxy's ${ethers.formatEther(underlying)} XRP`);
  }
  if (liq[2] > 0n) {
    issues.push(`Account is in shortfall (${ethers.formatEther(liq[2])} USD) — liquidatable, cannot withdraw`);
  }

  if (issues.length === 0) {
    console.log("  ✓  Full withdrawal is technically possible.");
    console.log("  ⚠  However: adapter uses redeemUnderlying(amount), not redeem(cTokens).");
    console.log("     If intent amount < current underlying (due to exchange rate drift),");
    console.log("     a small dust balance will remain locked in the proxy.");
    console.log("     FIX NEEDED: support amount=0 as a sentinel for 'redeem all cTokens'.");
  } else {
    console.log("  ✗  Full withdrawal is BLOCKED:");
    for (const issue of issues) {
      console.log(`     - ${issue}`);
    }
  }

  console.log("═".repeat(66) + "\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
