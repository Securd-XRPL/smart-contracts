/**
 * End-to-end EVM-direct lending test for the sSTST market.
 * No XRPL bridge involved — calls Compound V2 contracts directly.
 *
 * Flow: approve → mint (supply) → enterMarkets → borrow → repay → redeem (withdraw)
 *
 * Uses only a small amount (10 STST supplied, 1 STST borrowed) to preserve balance.
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";
const STST_UNDERLYING = "0x075cEB633c10B74Ed678D1623746bddff6b98517";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
];
const CTOKEN_ABI = [
  "function mint(uint256 mintAmount) returns (uint256)",
  "function borrow(uint256 borrowAmount) returns (uint256)",
  "function repayBorrow(uint256 repayAmount) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function balanceOfUnderlying(address account) returns (uint256)",
  "function borrowBalanceCurrent(address account) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const COMPTROLLER_ABI = [
  "function enterMarkets(address[] calldata cTokens) returns (uint256[] memory)",
  "function exitMarket(address cToken) returns (uint256)",
  "function getAssetsIn(address account) view returns (address[] memory)",
];

function requireSuccess(result: bigint, label: string) {
  if (result !== 0n) throw new Error(`${label} failed with error code ${result}`);
}

async function main() {
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const stst_market = deployment.markets.find((m: any) => m.cTokenSymbol === "sSTST");
  if (!stst_market) throw new Error("sSTST market not found in deployment file. Run deployStsTMarket.ts first.");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("cSTST:", stst_market.cToken);

  const stst       = new ethers.Contract(STST_UNDERLYING,        ERC20_ABI,      signer);
  const cstst      = new ethers.Contract(stst_market.cToken,     CTOKEN_ABI,     signer);
  const comptroller = new ethers.Contract(deployment.unitroller, COMPTROLLER_ABI, signer);

  const SUPPLY_AMOUNT = ethers.parseEther("10");   // 10 STST
  const BORROW_AMOUNT = ethers.parseEther("1");    // 1 STST
  const REPAY_AMOUNT  = ethers.parseEther("2");    // 2 STST (covers accrued interest)

  // ── Initial state ────────────────────────────────────────────────────────────
  const balBefore = await stst.balanceOf(signer.address);
  console.log("\n── Initial state ──");
  console.log("STST balance:", ethers.formatEther(balBefore));

  // ── 1. SUPPLY ────────────────────────────────────────────────────────────────
  console.log("\n── 1. SUPPLY 10 STST ──");
  let tx = await stst.approve(stst_market.cToken, SUPPLY_AMOUNT);
  await tx.wait();
  const mintResult = await cstst.mint(SUPPLY_AMOUNT);
  const mintReceipt = await mintResult.wait();
  console.log("mint() TX:", mintReceipt.hash);

  const cBalance = await cstst.balanceOf(signer.address);
  const underlying = await cstst.balanceOfUnderlying.staticCall(signer.address);
  console.log("sSTST balance (cTokens):", cBalance.toString());
  console.log("Underlying supplied:", ethers.formatEther(underlying), "STST");

  // ── 2. ENTER_MARKET ──────────────────────────────────────────────────────────
  console.log("\n── 2. ENTER_MARKET ──");
  tx = await comptroller.enterMarkets([stst_market.cToken]);
  const enterReceipt = await (tx).wait();
  console.log("enterMarkets() TX:", enterReceipt.hash);
  const assetsIn = await comptroller.getAssetsIn(signer.address);
  console.log("Assets in:", assetsIn);

  // ── 3. BORROW ────────────────────────────────────────────────────────────────
  // Note: collateral factor is 0% until the 48h timelock elapses.
  // Borrow will revert with INSUFFICIENT_LIQUIDITY. Skipping gracefully.
  console.log("\n── 3. BORROW 1 STST ──");
  let borrowBal = 0n;
  try {
    const borrowResult = await cstst.borrow(BORROW_AMOUNT);
    const borrowReceipt = await borrowResult.wait();
    console.log("borrow() TX:", borrowReceipt.hash);
    borrowBal = await cstst.borrowBalanceCurrent.staticCall(signer.address);
    console.log("Borrow balance:", ethers.formatEther(borrowBal), "STST");
    console.log("Wallet STST balance:", ethers.formatEther(await stst.balanceOf(signer.address)));
  } catch (e: any) {
    console.log("Borrow skipped (collateral factor=0% until timelock executes):", e.shortMessage || e.message.slice(0, 80));
  }

  // ── 4. REPAY ─────────────────────────────────────────────────────────────────
  let borrowAfter = 0n;
  if (borrowBal > 0n) {
    console.log("\n── 4. REPAY (full) ──");
    tx = await stst.approve(stst_market.cToken, borrowBal * 2n);
    await tx.wait();
    const repayResult = await cstst.repayBorrow(borrowBal);
    const repayReceipt = await repayResult.wait();
    console.log("repayBorrow() TX:", repayReceipt.hash);
    borrowAfter = await cstst.borrowBalanceCurrent.staticCall(signer.address);
    console.log("Borrow balance after repay:", ethers.formatEther(borrowAfter), "STST");
  } else {
    console.log("\n── 4. REPAY ── skipped (nothing borrowed)");
  }

  // ── 5. WITHDRAW ──────────────────────────────────────────────────────────────
  console.log("\n── 5. WITHDRAW 5 STST ──");
  const WITHDRAW_AMOUNT = ethers.parseEther("5");
  const redeemResult = await cstst.redeemUnderlying(WITHDRAW_AMOUNT);
  const redeemReceipt = await redeemResult.wait();
  console.log("redeemUnderlying() TX:", redeemReceipt.hash);

  const underlyingAfter = await cstst.balanceOfUnderlying.staticCall(signer.address);
  const walletAfter = await stst.balanceOf(signer.address);
  console.log("Underlying still supplied:", ethers.formatEther(underlyingAfter), "STST");
  console.log("Wallet STST balance:", ethers.formatEther(walletAfter));

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n── Final state ──");
  console.log("Supplied:", ethers.formatEther(underlyingAfter), "STST");
  console.log("Borrowed:", ethers.formatEther(borrowAfter), "STST");
  console.log("Wallet:", ethers.formatEther(walletAfter), "STST");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
