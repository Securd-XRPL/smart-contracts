/**
 * Deploys a cSTST market on top of the existing Securd stack.
 * Uses all already-deployed contracts (unitroller, oracle, IRM, cErc20Delegate, bridgeAdapter).
 *
 * Required env vars (all already in .env):
 *   XRPL_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY, DEPLOYMENT_OUTPUT_FILE
 *
 * Token details:
 *   STST ERC-20: 0x075cEB633c10B74Ed678D1623746bddff6b98517 (18 decimals)
 *   ITS tokenId: 0xf886c06430b802501c8baf27ffbb430b97bd39558ef72bfd48e47b066d1bb1c1
 *   Fallback price: $1.00 (1e18) — test token, no real price feed
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

const STST_UNDERLYING  = "0x075cEB633c10B74Ed678D1623746bddff6b98517";
const STST_TOKEN_ID    = "0xf886c06430b802501c8baf27ffbb430b97bd39558ef72bfd48e47b066d1bb1c1";
const STST_PRICE       = ethers.parseEther("1");          // $1.00
const STST_CF          = ethers.parseEther("0.70");       // 70% collateral factor
const FALLBACK_DELAY   = 86400n;                           // 24 h

const ORACLE_ABI = [
  "function setFallbackConfig(address asset, uint256 maxDelay) external",
  "function postFallbackPrice(address asset, uint256 priceMantissa) external",
  "function setOracleType(address asset, uint8 oracleType) external",
  "function setCTokenUnderlying(address cToken, address underlying) external",
];
const COMPTROLLER_ABI = [
  "function _supportMarket(address cToken) external returns (uint256)",
  "function _setCollateralFactor(address cToken, uint256 newCollateralFactorMantissa) external returns (uint256)",
];
const ADAPTER_ABI = [
  "function setMarket(address market, address underlying, bytes32 tokenId, bool listed) external",
];

async function main() {
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const oracle      = new ethers.Contract(deployment.oracle,           ORACLE_ABI,      deployer);
  const comptroller = new ethers.Contract(deployment.unitroller,       COMPTROLLER_ABI, deployer);
  const adapter     = new ethers.Contract(deployment.xrplBridgeAdapter, ADAPTER_ABI,   deployer);

  // 1. Deploy cSTST delegator
  console.log("Deploying cSTST market...");
  const Delegator = await ethers.getContractFactory("CErc20Delegator");
  const cToken = await Delegator.deploy(
    STST_UNDERLYING,
    deployment.unitroller,
    deployment.interestRateModel,
    ethers.parseEther("1"),           // initial exchange rate 1:1
    "Securd STST",
    "sSTST",
    8,
    deployer.address,
    deployment.cErc20DelegateImplementation,
    "0x"
  );
  await cToken.waitForDeployment();
  const cTokenAddr = await cToken.getAddress();
  console.log("cSTST deployed:", cTokenAddr);

  // 2. Support market in comptroller
  console.log("Supporting market...");
  await (await comptroller._supportMarket(cTokenAddr)).wait();

  // 3. Oracle: fallback config + initial price
  console.log("Setting oracle fallback config...");
  await (await oracle.setFallbackConfig(STST_UNDERLYING, FALLBACK_DELAY)).wait();
  await (await oracle.postFallbackPrice(STST_UNDERLYING, STST_PRICE)).wait();
  await (await oracle.setOracleType(STST_UNDERLYING, 3)).wait();       // 3 = FALLBACK
  await (await oracle.setCTokenUnderlying(cTokenAddr, STST_UNDERLYING)).wait();
  console.log("Oracle configured. STST price: $1.00");

  // 4. Collateral factor
  console.log("Setting collateral factor 70%...");
  await (await comptroller._setCollateralFactor(cTokenAddr, STST_CF)).wait();

  // 5. List on bridge adapter
  console.log("Listing on bridge adapter...");
  await (await adapter.setMarket(cTokenAddr, STST_UNDERLYING, STST_TOKEN_ID, true)).wait();

  // 6. Persist to deployment file
  deployment.markets.push({
    underlying: STST_UNDERLYING,
    cToken: cTokenAddr,
    cTokenSymbol: "sSTST",
    bridgeListed: true,
    oracleMode: "FALLBACK"
  });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));

  console.log("\nDone.");
  console.log("cSTST address:", cTokenAddr);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
