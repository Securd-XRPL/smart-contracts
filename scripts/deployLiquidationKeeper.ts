import { ethers } from "hardhat";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const owner = requiredEnv("KEEPER_OWNER");
  const [deployer] = await ethers.getSigners();

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Keeper owner: ${owner}`);

  const Keeper = await ethers.getContractFactory("SecurdLiquidationKeeper");
  const keeper = await Keeper.deploy(deployer.address);
  await keeper.waitForDeployment();

  const keeperAddress = await keeper.getAddress();
  console.log(`SecurdLiquidationKeeper deployed at: ${keeperAddress}`);

  const keepers = (process.env.KEEPER_EXECUTORS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const executor of keepers) {
    console.log(`Authorizing keeper: ${executor}`);
    const tx = await keeper.setKeeper(executor, true);
    await tx.wait();
  }

  const assetLimits = process.env.KEEPER_ASSET_LIMITS;
  if (assetLimits) {
    const parsed: Array<{ asset: string; limit: string }> = JSON.parse(assetLimits);
    for (const item of parsed) {
      console.log(`Setting asset limit: ${item.asset} -> ${item.limit}`);
      const tx = await keeper.setAssetLimit(item.asset, BigInt(item.limit));
      await tx.wait();
    }
  }

  const marketLimits = process.env.KEEPER_MARKET_LIMITS;
  if (marketLimits) {
    const parsed: Array<{ market: string; limit: string }> = JSON.parse(marketLimits);
    for (const item of parsed) {
      console.log(`Setting market limit: ${item.market} -> ${item.limit}`);
      const tx = await keeper.setMarketLimit(item.market, BigInt(item.limit));
      await tx.wait();
    }
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`Transferring keeper ownership to: ${owner}`);
    const tx = await keeper.transferOwnership(owner);
    await tx.wait();
  }

  console.log("Deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
