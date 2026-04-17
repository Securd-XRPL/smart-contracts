import { ethers } from "hardhat";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main() {
  const owner = requiredEnv("MEDIAN_REPORTER_OWNER");
  const fallbackOracle = requiredEnv("MEDIAN_REPORTER_FALLBACK_ORACLE");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Median reporter owner: ${owner}`);
  console.log(`Fallback oracle: ${fallbackOracle}`);

  const Factory = await ethers.getContractFactory("SecurdMedianOracleReporter");
  const reporter = await Factory.deploy(deployer.address, fallbackOracle);
  await reporter.waitForDeployment();

  console.log(`SecurdMedianOracleReporter deployed at: ${await reporter.getAddress()}`);

  const assetConfigs = (process.env.MEDIAN_REPORTER_ASSET_CONFIGS || "").trim();
  if (assetConfigs) {
    const parsed: Array<{ asset: string; roundDuration: string; minSubmissions: number }> = JSON.parse(assetConfigs);
    for (const config of parsed) {
      console.log(
        `Configuring asset ${config.asset}: duration=${config.roundDuration} minSubmissions=${config.minSubmissions}`
      );
      const tx = await reporter.setAssetConfig(config.asset, BigInt(config.roundDuration), config.minSubmissions);
      await tx.wait();
    }
  }

  const reporters = (process.env.MEDIAN_REPORTER_REPORTERS || "").trim();
  if (reporters) {
    const parsed: Array<{ asset: string; reporter: string }> = JSON.parse(reporters);
    for (const config of parsed) {
      console.log(`Authorizing reporter ${config.reporter} for asset ${config.asset}`);
      const tx = await reporter.setReporter(config.asset, config.reporter, true);
      await tx.wait();
    }
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`Transferring ownership to: ${owner}`);
    const tx = await reporter.transferOwnership(owner);
    await tx.wait();
  }

  console.log("Median reporter deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
