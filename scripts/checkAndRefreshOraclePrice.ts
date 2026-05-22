/**
 * Checks the oracle fallback price for STST and refreshes it if stale or expired.
 * Run this before executeSetCollateralFactor.ts when the 24h fallback TTL may have lapsed.
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";
const STST_UNDERLYING = "0x075cEB633c10B74Ed678D1623746bddff6b98517";
const STST_PRICE      = ethers.parseEther("1");  // $1.00

const ORACLE_ABI = [
  "function postFallbackPrice(address asset, uint256 priceMantissa) external",
  "function setFallbackConfig(address asset, uint256 maxDelay) external",
  "function assetConfig(address) view returns (uint8 oracleType, address chainlinkFeed, uint256 chainlinkHeartbeat, string bandBaseSymbol, string bandQuoteSymbol, uint256 bandMaxDelay, uint256 fallbackMaxDelay)",
  "function fallbackPriceOf(address) view returns (uint256 priceMantissa, uint256 updatedAt)",
  "function getUnderlyingPrice(address cToken) view returns (uint256)",
];

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const stst = dep.markets.find((m: any) => m.cTokenSymbol === "sSTST");
  if (!stst) throw new Error("sSTST market not found");

  const [signer] = await ethers.getSigners();
  const oracle = new ethers.Contract(dep.oracle, ORACLE_ABI, signer);

  const cfg      = await oracle.assetConfig(STST_UNDERLYING);
  const fp       = await oracle.fallbackPriceOf(STST_UNDERLYING);
  const now      = Math.floor(Date.now() / 1000);
  const age      = now - Number(fp.updatedAt);
  const expired  = age > Number(cfg.fallbackMaxDelay);

  console.log("Oracle type:       ", cfg.oracleType.toString(), "(3=FALLBACK)");
  console.log("Fallback price:    ", ethers.formatEther(fp.priceMantissa), "USD");
  console.log("Fallback updatedAt:", new Date(Number(fp.updatedAt) * 1000).toISOString());
  console.log("Max delay:         ", cfg.fallbackMaxDelay.toString(), "s");
  console.log("Age:               ", age, "s (", (age / 3600).toFixed(1), "h)");
  console.log("Expired:           ", expired);

  const price = await oracle.getUnderlyingPrice(stst.cToken);
  console.log("getUnderlyingPrice:", ethers.formatEther(price), "(0 = CF set will fail)");

  if (price === 0n || expired) {
    console.log("\nRefreshing fallback price...");
    // Extend maxDelay to 30 days so it stays valid through testing
    await (await oracle.setFallbackConfig(STST_UNDERLYING, 30 * 86400)).wait();
    await (await oracle.postFallbackPrice(STST_UNDERLYING, STST_PRICE)).wait();
    const newPrice = await oracle.getUnderlyingPrice(stst.cToken);
    console.log("New price:", ethers.formatEther(newPrice));
  } else {
    console.log("\nPrice is fresh — no refresh needed.");
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
