import { ethers } from "hardhat";
import {
  loadDeploymentSummary,
  loadMarketConfigArray,
  loadTrustedGmpSources,
  loadTrustedItsSources
} from "./securdDeploymentConfig";

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

function normalizeTextBytes(value: string): string {
  return ethers.hexlify(ethers.toUtf8Bytes(value));
}

function assertEqual(actual: string | bigint | boolean, expected: string | bigint | boolean, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected.toString()}, got ${actual.toString()}`);
  }
}

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ethers.ZeroAddress.toLowerCase();
}

async function main() {
  const deploymentRecordPath = requiredEnv("DEPLOYMENT_RECORD_FILE");
  const deployment = loadDeploymentSummary(deploymentRecordPath);
  const marketsPath = optionalEnv("SECURD_MARKETS_FILE");
  const gmpSourcesPath = optionalEnv("XRPL_TRUSTED_GMP_SOURCES_FILE");
  const itsSourcesPath = optionalEnv("XRPL_TRUSTED_ITS_SOURCES_FILE");

  const unitroller = await ethers.getContractAt("Unitroller", deployment.unitroller);
  const comptroller = await ethers.getContractAt("Comptroller", deployment.comptrollerProxy);
  const oracle = await ethers.getContractAt("SecurdPriceOracle", deployment.oracle);
  const keeper = await ethers.getContractAt("SecurdLiquidationKeeper", deployment.liquidationKeeper);
  const proxyFactory = await ethers.getContractAt("XRPLUserProxyFactory", deployment.xrplUserProxyFactory);
  const bridgeAdapter = await ethers.getContractAt("XRPLSecurdBridgeAdapter", deployment.xrplBridgeAdapter);

  const checks: string[] = [];

  assertEqual((await oracle.owner()).toLowerCase(), deployment.owner.toLowerCase(), "oracle.owner");
  checks.push("oracle owner");

  assertEqual((await keeper.owner()).toLowerCase(), deployment.owner.toLowerCase(), "liquidationKeeper.owner");
  checks.push("keeper owner");

  assertEqual((await proxyFactory.owner()).toLowerCase(), deployment.owner.toLowerCase(), "proxyFactory.owner");
  checks.push("proxy factory owner");

  assertEqual((await bridgeAdapter.owner()).toLowerCase(), deployment.owner.toLowerCase(), "bridgeAdapter.owner");
  checks.push("bridge adapter owner");

  assertEqual((await proxyFactory.controller()).toLowerCase(), deployment.xrplBridgeAdapter.toLowerCase(), "proxyFactory.controller");
  checks.push("proxy factory controller");

  const unitrollerAdmin = (await unitroller.admin()).toLowerCase();
  const unitrollerPendingAdmin = (await unitroller.pendingAdmin()).toLowerCase();
  const recordedAdmin = deployment.comptrollerAdmin.toLowerCase();
  const recordedPendingAdmin = deployment.comptrollerPendingAdmin.toLowerCase();
  const expectedAdmin = deployment.comptrollerExpectedAdmin.toLowerCase();

  const handoffAccepted = unitrollerAdmin === expectedAdmin && isZeroAddress(unitrollerPendingAdmin);
  const handoffPending = unitrollerAdmin === recordedAdmin && unitrollerPendingAdmin === recordedPendingAdmin;

  if (!handoffAccepted && !handoffPending) {
    throw new Error(
      `unitroller admin state mismatch: expected either admin=${deployment.comptrollerAdmin}, pending=${deployment.comptrollerPendingAdmin} or admin=${deployment.comptrollerExpectedAdmin}, pending=${ethers.ZeroAddress}; got admin=${await unitroller.admin()}, pending=${await unitroller.pendingAdmin()}`
    );
  }

  checks.push(handoffAccepted ? "unitroller admin accepted" : "unitroller admin pending");

  assertEqual((await comptroller.oracle()).toLowerCase(), deployment.oracle.toLowerCase(), "comptroller.oracle");
  checks.push("comptroller oracle");

  const bridgeDestinationChain = optionalEnv("XRPL_DESTINATION_CHAIN");
  if (bridgeDestinationChain) {
    assertEqual(await bridgeAdapter.destinationChain(), bridgeDestinationChain, "bridgeAdapter.destinationChain");
    checks.push("bridge destination chain");
  }

  if (marketsPath) {
    const marketConfigs = loadMarketConfigArray(marketsPath);
    if (marketConfigs.length !== deployment.markets.length) {
      throw new Error(`market count mismatch: deployment record has ${deployment.markets.length}, config has ${marketConfigs.length}`);
    }

    for (let i = 0; i < deployment.markets.length; i += 1) {
      const deployedMarket = deployment.markets[i];
      const configuredMarket = marketConfigs[i];
      const marketContract = await ethers.getContractAt("CErc20Delegator", deployedMarket.cToken);
      const marketState = await comptroller.markets(deployedMarket.cToken);
      const bridgeMarketState = await bridgeAdapter.marketConfigOf(deployedMarket.cToken);

      assertEqual((await marketContract.underlying()).toLowerCase(), configuredMarket.underlying.toLowerCase(), `market[${i}].underlying`);
      assertEqual(marketState[0], True, `market[${i}].isListed`);
      assertEqual(marketState[1], BigInt(configuredMarket.collateralFactorMantissa), `market[${i}].collateralFactor`);
      assertEqual(bridgeMarketState[2], configuredMarket.listOnBridge !== false, `market[${i}].bridgeListed`);
      if (configuredMarket.listOnBridge !== false) {
        assertEqual(bridgeMarketState[0].toLowerCase(), configuredMarket.underlying.toLowerCase(), `market[${i}].bridgeUnderlying`);
      }
      checks.push(`market ${deployedMarket.cTokenSymbol}`);
    }
  }

  if (gmpSourcesPath) {
    const gmpSources = loadTrustedGmpSources(gmpSourcesPath);
    for (const source of gmpSources) {
      const sourceId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], [source.chain, source.address]));
      assertEqual(await bridgeAdapter.trustedGmpSource(sourceId), true, `trustedGmpSource ${source.chain}:${source.address}`);
      checks.push(`trusted GMP source ${source.chain}:${source.address}`);
    }
  }

  if (itsSourcesPath) {
    const itsSources = loadTrustedItsSources(itsSourcesPath);
    for (const source of itsSources) {
      const encodedAddress = source.encoding === "hex" ? source.address : normalizeTextBytes(source.address);
      const sourceId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes"], [source.chain, encodedAddress]));
      assertEqual(await bridgeAdapter.trustedItsSource(sourceId), true, `trustedItsSource ${source.chain}:${source.address}`);
      checks.push(`trusted ITS source ${source.chain}:${source.address}`);
    }
  }

  console.log(`Verified deployed Securd stack using ${deploymentRecordPath}`);
  for (const check of checks) {
    console.log(`- ${check}`);
  }
}

const True = true;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
