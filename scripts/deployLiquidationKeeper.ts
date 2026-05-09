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
    if (!ethers.isAddress(executor)) {
      throw new Error(`KEEPER_EXECUTORS contains invalid address: ${executor}`);
    }
    console.log(`Authorizing keeper: ${executor}`);
    const tx = await keeper.setKeeper(executor, true);
    await tx.wait();
  }

  const assetLimits = process.env.KEEPER_ASSET_LIMITS;
  if (assetLimits) {
    let parsed: Array<{ asset: string; limit: string }>;
    try {
      parsed = JSON.parse(assetLimits);
    } catch {
      throw new Error("KEEPER_ASSET_LIMITS is not valid JSON");
    }
    for (const item of parsed) {
      if (!ethers.isAddress(item.asset)) throw new Error(`Invalid asset address in KEEPER_ASSET_LIMITS: ${item.asset}`);
      let limitBigInt: bigint;
      try { limitBigInt = BigInt(item.limit); } catch {
        throw new Error(`Invalid limit in KEEPER_ASSET_LIMITS for ${item.asset}: ${item.limit}`);
      }
      console.log(`Setting asset limit: ${item.asset} -> ${item.limit}`);
      const tx = await keeper.setAssetLimit(item.asset, limitBigInt);
      await tx.wait();
    }
  }

  const marketLimits = process.env.KEEPER_MARKET_LIMITS;
  if (marketLimits) {
    let parsed: Array<{ market: string; limit: string }>;
    try {
      parsed = JSON.parse(marketLimits);
    } catch {
      throw new Error("KEEPER_MARKET_LIMITS is not valid JSON");
    }
    for (const item of parsed) {
      if (!ethers.isAddress(item.market)) throw new Error(`Invalid market address in KEEPER_MARKET_LIMITS: ${item.market}`);
      let limitBigInt: bigint;
      try { limitBigInt = BigInt(item.limit); } catch {
        throw new Error(`Invalid limit in KEEPER_MARKET_LIMITS for ${item.market}: ${item.limit}`);
      }
      console.log(`Setting market limit: ${item.market} -> ${item.limit}`);
      const tx = await keeper.setMarketLimit(item.market, limitBigInt);
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
