import { ethers } from "hardhat";
import { loadDeploymentSummary } from "./securdDeploymentConfig";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function assertEqual(actual: string, expected: string, label: string) {
  if (actual.toLowerCase() != expected.toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  const deploymentRecordPath = requiredEnv("DEPLOYMENT_RECORD_FILE");
  const deployment = loadDeploymentSummary(deploymentRecordPath);
  const expectedDestinationChain = optionalEnv("XRPL_DESTINATION_CHAIN");

  const unitroller = await ethers.getContractAt("Unitroller", deployment.unitroller);
  const comptroller = await ethers.getContractAt("Comptroller", deployment.comptrollerProxy);
  const oracle = await ethers.getContractAt("SecurdPriceOracle", deployment.oracle);
  const keeper = await ethers.getContractAt("SecurdLiquidationKeeper", deployment.liquidationKeeper);
  const proxyFactory = await ethers.getContractAt("XRPLUserProxyFactory", deployment.xrplUserProxyFactory);
  const bridgeAdapter = await ethers.getContractAt("XRPLSecurdBridgeAdapter", deployment.xrplBridgeAdapter);

  assertEqual(await oracle.owner(), deployment.owner, "oracle.owner");
  assertEqual(await keeper.owner(), deployment.owner, "liquidationKeeper.owner");
  assertEqual(await proxyFactory.owner(), deployment.owner, "proxyFactory.owner");
  assertEqual(await bridgeAdapter.owner(), deployment.owner, "bridgeAdapter.owner");
  assertEqual(await proxyFactory.controller(), deployment.xrplBridgeAdapter, "proxyFactory.controller");
  assertEqual(await unitroller.pendingAdmin(), deployment.comptrollerPendingAdmin, "unitroller.pendingAdmin");
  assertEqual(await comptroller.oracle(), deployment.oracle, "comptroller.oracle");

  if (expectedDestinationChain) {
    const actualDestinationChain = await bridgeAdapter.destinationChain();
    if (actualDestinationChain !== expectedDestinationChain) {
      throw new Error(`bridgeAdapter.destinationChain mismatch: expected ${expectedDestinationChain}, got ${actualDestinationChain}`);
    }
  }

  console.log(`Smoke check passed for ${deploymentRecordPath}`);
  console.log(`- oracle owner`);
  console.log(`- keeper owner`);
  console.log(`- proxy factory owner`);
  console.log(`- bridge adapter owner`);
  console.log(`- proxy factory controller`);
  console.log(`- unitroller pending admin`);
  console.log(`- comptroller oracle`);
  if (expectedDestinationChain) {
    console.log(`- bridge destination chain`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
