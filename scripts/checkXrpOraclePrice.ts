import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";
// XRP is native so its "underlying" in the oracle is the sentinel address
const XRP_UNDERLYING = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const XRP_PRICE = ethers.parseEther("0.5"); // $0.50 — keep same as before

const ORACLE_ABI = [
  "function postFallbackPrice(address asset, uint256 priceMantissa) external",
  "function setFallbackConfig(address asset, uint256 maxDelay) external",
  "function assetConfig(address) view returns (uint8 oracleType, address chainlinkFeed, uint256 chainlinkHeartbeat, string bandBaseSymbol, string bandQuoteSymbol, uint256 bandMaxDelay, uint256 fallbackMaxDelay)",
  "function fallbackPriceOf(address) view returns (uint256 priceMantissa, uint256 updatedAt)",
  "function getUnderlyingPrice(address cToken) view returns (uint256)",
];

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const xrp = dep.markets.find((m: any) => m.cTokenSymbol === "sXRP");
  if (!xrp) throw new Error("sXRP market not found");

  const [signer] = await ethers.getSigners();
  const oracle = new ethers.Contract(dep.oracle, ORACLE_ABI, signer);

  const cfg = await oracle.assetConfig(XRP_UNDERLYING);
  const fp  = await oracle.fallbackPriceOf(XRP_UNDERLYING);
  const now = Math.floor(Date.now() / 1000);
  const age = fp.updatedAt > 0n ? now - Number(fp.updatedAt) : -1;
  const expired = age > Number(cfg.fallbackMaxDelay);

  console.log("Oracle type:       ", cfg.oracleType.toString(), "(3=FALLBACK)");
  console.log("Fallback price:    $", ethers.formatEther(fp.priceMantissa));
  console.log("Fallback updatedAt:", fp.updatedAt > 0n ? new Date(Number(fp.updatedAt) * 1000).toISOString() : "never");
  console.log("Max delay:         ", cfg.fallbackMaxDelay.toString(), "s (", (Number(cfg.fallbackMaxDelay)/3600).toFixed(1), "h)");
  console.log("Age:               ", age, "s (", (age/3600).toFixed(1), "h)");
  console.log("Expired:           ", expired);

  const price = await oracle.getUnderlyingPrice(xrp.cToken);
  console.log("getUnderlyingPrice:", ethers.formatEther(price), "(0 = borrow will fail)");

  if (price === 0n || expired) {
    console.log("\nRefreshing XRP oracle price ($0.50, 30-day TTL)...");
    await (await oracle.setFallbackConfig(XRP_UNDERLYING, 30 * 86400)).wait();
    await (await oracle.postFallbackPrice(XRP_UNDERLYING, XRP_PRICE)).wait();
    const newPrice = await oracle.getUnderlyingPrice(xrp.cToken);
    console.log("New price: $", ethers.formatEther(newPrice));
  } else {
    console.log("\nXRP oracle price is fresh.");
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
