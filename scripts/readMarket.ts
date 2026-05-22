import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

const CTOKEN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
  "function decimals() view returns (uint8)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
];
const COMPTROLLER_ABI = [
  "function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
];
const ORACLE_ABI = [
  "function getUnderlyingPrice(address cToken) view returns (uint256)",
];

function toUSD(amount: bigint, price: bigint): string {
  // amount and price are both 18-decimal mantissas
  const usd = (amount * price) / ethers.parseEther("1");
  return "$" + ethers.formatEther(usd);
}

async function printMarket(symbol: string, cTokenAddr: string, comptrollerAddr: string, oracleAddr: string, provider: ethers.Provider) {
  const c            = new ethers.Contract(cTokenAddr, CTOKEN_ABI, provider);
  const comptroller  = new ethers.Contract(comptrollerAddr, COMPTROLLER_ABI, provider);
  const oracle       = new ethers.Contract(oracleAddr, ORACLE_ABI, provider);

  const [totalSupplyCT, totalBorrows, cash, reserves, decimals, market, price, supplyRate, borrowRate] =
    await Promise.all([
      c.totalSupply(), c.totalBorrows(), c.getCash(), c.totalReserves(),
      c.decimals(), comptroller.markets(cTokenAddr),
      oracle.getUnderlyingPrice(cTokenAddr),
      c.supplyRatePerBlock(), c.borrowRatePerBlock(),
    ]);

  const exchangeRate          = await c.exchangeRateCurrent.staticCall();
  const totalSupplyUnderlying = (totalSupplyCT * exchangeRate) / ethers.parseEther("1");
  const denom                 = cash + totalBorrows;
  const utilization           = denom > 0n ? Number(totalBorrows * 10000n / denom) / 100 : 0;
  // XRPL EVM: ~3.5s blocks → 9,014,400 blocks/year (matches IRM constructor)
  // Formula: ratePerBlock / 1e18 * blocksPerYear * 100 = APY%
  // Use ×1e6 precision factor to survive BigInt integer division
  const BLOCKS_PER_YEAR       = 9_014_400n;
  const PRECISION             = 1_000_000n;
  const supplyAPY             = Number(supplyRate * BLOCKS_PER_YEAR * 100n * PRECISION / ethers.parseEther("1")) / Number(PRECISION);
  const borrowAPY             = Number(borrowRate * BLOCKS_PER_YEAR * 100n * PRECISION / ethers.parseEther("1")) / Number(PRECISION);

  const underlying = symbol.slice(1); // "XRP" or "STST"

  console.log(`\n${"═".repeat(60)}`);
  console.log(` ${symbol}   ${cTokenAddr}`);
  console.log(`${"═".repeat(60)}`);
  console.log(` Listed             : ${market.isListed}`);
  console.log(` Collateral Factor  : ${(Number(market.collateralFactorMantissa) / 1e18 * 100).toFixed(0)} %`);
  console.log(` Oracle Price       : $${ethers.formatEther(price)}`);
  console.log(``);
  console.log(` Total Supply  (tokens) : ${ethers.formatEther(totalSupplyUnderlying)} ${underlying}`);
  console.log(` Total Supply  (USD)    : ${toUSD(totalSupplyUnderlying, price)}`);
  console.log(` Total Borrows (tokens) : ${ethers.formatEther(totalBorrows)} ${underlying}`);
  console.log(` Total Borrows (USD)    : ${toUSD(totalBorrows, price)}`);
  console.log(` Cash (liquidity)       : ${ethers.formatEther(cash)} ${underlying}  /  ${toUSD(cash, price)}`);
  console.log(` Total Reserves         : ${ethers.formatEther(reserves)} ${underlying}`);
  console.log(``);
  console.log(` Utilization Rate   : ${utilization.toFixed(2)} %`);
  console.log(` Supply APY (est.)  : ${supplyAPY.toFixed(4)} %`);
  console.log(` Borrow APY (est.)  : ${borrowAPY.toFixed(4)} %`);
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  console.log(`\nSecurd Markets — XRPL EVM Testnet`);
  console.log(`Comptroller : ${dep.unitroller}`);
  console.log(`Oracle      : ${dep.oracle}`);

  let totalTVL = 0n;
  let totalBorrowsUSD = 0n;

  const oracle = new ethers.Contract(dep.oracle, ORACLE_ABI, ethers.provider);

  for (const market of dep.markets) {
    await printMarket(market.cTokenSymbol, market.cToken, dep.unitroller, dep.oracle, ethers.provider);

    // accumulate protocol-wide totals
    const c             = new ethers.Contract(market.cToken, CTOKEN_ABI, ethers.provider);
    const [ct, tb, er, price] = await Promise.all([
      c.totalSupply(), c.totalBorrows(),
      c.exchangeRateCurrent.staticCall(),
      oracle.getUnderlyingPrice(market.cToken),
    ]);
    const supplyUnderlying = (ct * er) / ethers.parseEther("1");
    totalTVL         += (supplyUnderlying * price) / ethers.parseEther("1");
    totalBorrowsUSD  += (tb * price) / ethers.parseEther("1");
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(` Protocol Totals`);
  console.log(`${"═".repeat(60)}`);
  console.log(` Total Value Locked (TVL) : $${ethers.formatEther(totalTVL)}`);
  console.log(` Total Borrows            : $${ethers.formatEther(totalBorrowsUSD)}`);
  console.log();
}

main().catch(e => { console.error(e); process.exitCode = 1; });
