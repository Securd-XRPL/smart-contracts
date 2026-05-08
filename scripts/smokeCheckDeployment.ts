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

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ethers.ZeroAddress.toLowerCase();
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
  const unitrollerAdmin = await unitroller.admin();
  const unitrollerPendingAdmin = await unitroller.pendingAdmin();
  const handoffAccepted =
    unitrollerAdmin.toLowerCase() === deployment.comptrollerExpectedAdmin.toLowerCase() && isZeroAddress(unitrollerPendingAdmin);
  const handoffPending =
    unitrollerAdmin.toLowerCase() === deployment.comptrollerAdmin.toLowerCase() &&
    unitrollerPendingAdmin.toLowerCase() === deployment.comptrollerPendingAdmin.toLowerCase();

  if (!handoffAccepted && !handoffPending) {
    throw new Error(
      `unitroller admin state mismatch: expected either admin=${deployment.comptrollerAdmin}, pending=${deployment.comptrollerPendingAdmin} or admin=${deployment.comptrollerExpectedAdmin}, pending=${ethers.ZeroAddress}; got admin=${unitrollerAdmin}, pending=${unitrollerPendingAdmin}`
    );
  }
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
  console.log(`- unitroller admin state`);
  console.log(`- comptroller oracle`);
  if (expectedDestinationChain) {
    console.log(`- bridge destination chain`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
