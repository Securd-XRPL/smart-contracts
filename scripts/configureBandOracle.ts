/**
 * Switches sXRP and sSTST markets from FALLBACK oracle to Band Protocol.
 *
 * Band StdReferenceProxy on XRPL EVM testnet: 0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68
 * Source: https://docs.bandchain.org/develop/supported-blockchains
 *
 *   sXRP  → Band XRP/USD
 *   sSTST → Band USDC/USD  (STST is pegged to USDC; uses USDC price as proxy)
 *
 * Steps executed:
 *   1. setBandStdReference  — point oracle to Band proxy contract
 *   2. setBandConfig        — set base/quote symbols + max staleness for each asset
 *   3. setOracleType        — switch each asset to BAND (type 2)
 *   4. Verify               — call getUnderlyingPrice on both cTokens, abort if 0
 *
 * Caller must be oracle owner (deployer: 0x243CD17C18052dD49B803dB5be3c2907DA6ff783).
 *
 * Required env vars: XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

// Band StdReferenceProxy on XRPL EVM testnet
// Source: https://docs.bandchain.org/develop/supported-blockchains
const BAND_STD_REFERENCE = "0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68";

// Band max staleness: 1 hour. Band updates roughly every 10 minutes on testnet.
// Increase to 3600 * 4 if testnet updates are infrequent.
const BAND_MAX_DELAY = 3600; // seconds

const XRP_UNDERLYING  = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ORACLE_ABI = [
  "function owner() view returns (address)",
  "function bandStdReference() view returns (address)",
  "function setBandStdReference(address newBandStdReference) external",
  "function setBandConfig(address asset, string calldata bandBaseSymbol, string calldata bandQuoteSymbol, uint256 bandMaxDelay) external",
  "function setFallbackConfig(address asset, uint256 fallbackMaxDelay) external",
  "function postFallbackPrice(address asset, uint256 priceMantissa) external",
  "function setOracleType(address asset, uint8 oracleType) external",
  "function getUnderlyingPrice(address cToken) view returns (uint256)",
  "function assetConfig(address) view returns (uint8 oracleType, address chainlinkFeed, uint256 chainlinkHeartbeat, string bandBaseSymbol, string bandQuoteSymbol, uint256 bandMaxDelay, uint256 fallbackMaxDelay)",
  "function previewPrices(address asset) view returns (uint8 oracleType, uint256 chainlinkPrice, uint256 bandPrice, uint256 fallbackPrice, uint256 selectedPrice)",
];

// Constant $1.00 price for STST when Band USDC/USD is not available (18-decimal mantissa)
const USDC_FALLBACK_PRICE   = ethers.parseEther("1");
// Fallback TTL: 365 days — essentially permanent for a $1 stablecoin constant
const USDC_FALLBACK_MAX_DELAY = 365 * 86400;

// OracleType enum values
const ORACLE_TYPE_BAND = 2;

async function main() {
  const dep   = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const sXRP  = dep.markets.find((m: any) => m.cTokenSymbol === "sXRP");
  const sSTST = dep.markets.find((m: any) => m.cTokenSymbol === "sSTST");
  if (!sXRP || !sSTST) throw new Error("Markets not found in deployment file");

  const [signer] = await ethers.getSigners();
  console.log("Signer :", signer.address);
  console.log("Oracle :", dep.oracle);

  const oracle = new ethers.Contract(dep.oracle, ORACLE_ABI, signer);

  const oracleOwner = await oracle.owner();
  if (oracleOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Not oracle owner — owner is ${oracleOwner}`);
  }

  // ── Current state ─────────────────────────────────────────────────────────
  const currentBandRef = await oracle.bandStdReference();
  console.log("\nCurrent bandStdReference:", currentBandRef);

  const cfgXRP  = await oracle.assetConfig(XRP_UNDERLYING);
  const cfgSTST = await oracle.assetConfig(sSTST.underlying);
  console.log("\nsXRP  oracle type:", cfgXRP.oracleType.toString(), "(1=CHAINLINK 2=BAND 3=FALLBACK)");
  console.log("sSTST oracle type:", cfgSTST.oracleType.toString());

  // ── Step 1: set Band StdReference ─────────────────────────────────────────
  if (currentBandRef.toLowerCase() !== BAND_STD_REFERENCE.toLowerCase()) {
    console.log("\n[1/5] Setting bandStdReference →", BAND_STD_REFERENCE);
    const tx = await oracle.setBandStdReference(BAND_STD_REFERENCE);
    await tx.wait();
    console.log("  Done. TX:", tx.hash);
  } else {
    console.log("\n[1/5] bandStdReference already set — skipping.");
  }

  // ── Step 2: configure Band for sXRP (XRP/USD) ────────────────────────────
  console.log("\n[2/5] setBandConfig for sXRP (XRP / USD, maxDelay", BAND_MAX_DELAY, "s)");
  const tx2 = await oracle.setBandConfig(XRP_UNDERLYING, "XRP", "USD", BAND_MAX_DELAY);
  await tx2.wait();
  console.log("  Done. TX:", tx2.hash);

  // ── Step 3: configure Band for sSTST (USDC/USD) ──────────────────────────
  // STST is pegged to USDC. Band provides USDC/USD on XRPL EVM testnet.
  // If USDC/USD is not yet live on this Band deployment, previewPrices will show bandPrice=0.
  console.log("\n[3/5] setBandConfig for sSTST (USDC / USD, maxDelay", BAND_MAX_DELAY, "s)");
  const tx3 = await oracle.setBandConfig(sSTST.underlying, "USDC", "USD", BAND_MAX_DELAY);
  await tx3.wait();
  console.log("  Done. TX:", tx3.hash);

  // ── Step 4: preview prices BEFORE switching (sanity check) ───────────────
  console.log("\n[4/5] Previewing Band prices before switching oracle type...");

  const previewXRP  = await oracle.previewPrices(XRP_UNDERLYING);
  const previewSTST = await oracle.previewPrices(sSTST.underlying);

  console.log("\n  sXRP Band price  :", ethers.formatEther(previewXRP.bandPrice), "USD");
  console.log("  sSTST Band price :", ethers.formatEther(previewSTST.bandPrice), "USD");

  if (previewXRP.bandPrice === 0n) {
    throw new Error(
      "Band XRP/USD price is 0 — feed may be stale or not yet active on this testnet deployment.\n" +
      "Check https://docs.bandchain.org/develop/supported-blockchains and verify BAND_STD_REFERENCE is correct."
    );
  }

  if (previewSTST.bandPrice === 0n) {
    console.log(
      "\n  Band USDC/USD returned 0 — USDC/USD not yet live on this Band deployment.\n" +
      "  Falling back to FALLBACK oracle with constant price $1.00 for sSTST."
    );
  }

  // ── Step 5: setOracleType ─────────────────────────────────────────────────
  console.log("\n[5/5] Switching oracle types...");

  console.log("  sXRP → BAND");
  const tx5a = await oracle.setOracleType(XRP_UNDERLYING, ORACLE_TYPE_BAND);
  await tx5a.wait();
  console.log("  Done. TX:", tx5a.hash);

  if (previewSTST.bandPrice !== 0n) {
    console.log("  sSTST → BAND (USDC/USD)");
    const tx5b = await oracle.setOracleType(sSTST.underlying, ORACLE_TYPE_BAND);
    await tx5b.wait();
    console.log("  Done. TX:", tx5b.hash);
  } else {
    // Band USDC/USD unavailable — post constant $1 fallback price
    console.log("  sSTST → FALLBACK ($1.00 constant price)");
    const txFa = await oracle.setFallbackConfig(sSTST.underlying, USDC_FALLBACK_MAX_DELAY);
    await txFa.wait();
    console.log("  setFallbackConfig done. TX:", txFa.hash);
    const txFb = await oracle.postFallbackPrice(sSTST.underlying, USDC_FALLBACK_PRICE);
    await txFb.wait();
    console.log("  postFallbackPrice $1.00 done. TX:", txFb.hash);
    const txFc = await oracle.setOracleType(sSTST.underlying, 3); // FALLBACK
    await txFc.wait();
    console.log("  setOracleType FALLBACK done. TX:", txFc.hash);
  }

  // ── Verification ──────────────────────────────────────────────────────────
  console.log("\n=== Verification ===");

  const priceXRP  = await oracle.getUnderlyingPrice(sXRP.cToken);
  const priceSTST = await oracle.getUnderlyingPrice(sSTST.cToken);

  console.log("sXRP  getUnderlyingPrice:", ethers.formatEther(priceXRP), "USD",
    priceXRP === 0n ? "← PROBLEM: still 0!" : "OK");
  console.log("sSTST getUnderlyingPrice:", ethers.formatEther(priceSTST), "USD",
    priceSTST === 0n ? "← WARNING: 0 (USDC/USD not yet live)" : "OK");

  if (priceXRP === 0n) {
    throw new Error("sXRP price is 0 after switch — reverting oracle type is recommended.");
  }

  // ── Update deployment file ─────────────────────────────────────────────────
  dep.bandStdReference = BAND_STD_REFERENCE;
  sXRP.oracleMode  = "BAND";
  if (previewSTST.bandPrice !== 0n) {
    sSTST.oracleMode = "BAND";
  } else {
    sSTST.oracleMode = "FALLBACK_CONSTANT_1USD";
  }
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(dep, null, 2));
  console.log("\nDeployment file updated.");

  console.log("\nDone.");
  console.log("  sXRP  oracle : Band XRP/USD");
  if (previewSTST.bandPrice !== 0n) {
    console.log("  sSTST oracle : Band USDC/USD");
  } else {
    console.log("  sSTST oracle : FALLBACK constant $1.00 (re-run configureBandOracle when Band USDC/USD goes live)");
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
