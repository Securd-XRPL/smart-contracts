// @ts-nocheck
import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

import {
  type DeploymentSummary,
  type MarketConfig,
  type OracleMode,
  type TrustedGmpSourceConfig,
  type TrustedItsSourceConfig,
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

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function safeParseJson<T>(raw: string, envVarName: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${envVarName} contains invalid JSON`);
  }
}

function confinedOutputPath(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    throw new Error(`DEPLOYMENT_OUTPUT_FILE must be within the working directory (got: ${resolved})`);
  }
  return resolved;
}

function parseScaled(value: string): bigint {
  return BigInt(value);
}

function parseOptionalScaled(value?: string): bigint | undefined {
  return value ? BigInt(value) : undefined;
}

function loadTrustedGmpSourcesFromEnv(): TrustedGmpSourceConfig[] {
  const filePath = process.env.XRPL_TRUSTED_GMP_SOURCES_FILE;
  if (!filePath) return [];
  return loadTrustedGmpSources(filePath);
}

function loadTrustedItsSourcesFromEnv(): TrustedItsSourceConfig[] {
  const filePath = process.env.XRPL_TRUSTED_ITS_SOURCES_FILE;
  if (!filePath) return [];
  return loadTrustedItsSources(filePath);
}

function loadMarketsFromEnv(): MarketConfig[] {
  const filePath = process.env.SECURD_MARKETS_FILE;
  if (!filePath) return [];
  return loadMarketConfigArray(filePath);
}

function encodeItsSourceAddress(source: TrustedItsSourceConfig): string {
  if (source.encoding === "hex") {
    return source.address;
  }
  return ethers.hexlify(ethers.toUtf8Bytes(source.address));
}

function resolveBridgeTokenId(config: MarketConfig): string {
  if (config.bridgeTokenId) {
    return config.bridgeTokenId;
  }

  const label = config.bridgeTokenIdLabel || config.cTokenSymbol;
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function toOracleType(mode: OracleMode): number {
  if (mode === "CHAINLINK") return 1;
  if (mode === "BAND") return 2;
  if (mode === "FALLBACK") return 3;
  throw new Error(`Unknown oracle mode: "${mode}". Expected CHAINLINK, BAND, or FALLBACK.`);
}

async function maybeTransferOwnership(contract: { owner(): Promise<string>; transferOwnership(nextOwner: string): Promise<{ wait(): Promise<unknown> }> }, nextOwner: string) {
  const currentOwner = await contract.owner();
  if (currentOwner.toLowerCase() === nextOwner.toLowerCase()) {
    return;
  }

  const tx = await contract.transferOwnership(nextOwner);
  await tx.wait();
}

async function main() {
  const owner = requiredEnv("DEPLOY_OWNER");
  if (!ethers.isAddress(owner)) throw new Error(`DEPLOY_OWNER is not a valid address: ${owner}`);
  const axelarGateway = requiredEnv("AXELAR_GATEWAY");
  if (!ethers.isAddress(axelarGateway)) throw new Error(`AXELAR_GATEWAY is not a valid address: ${axelarGateway}`);
  const interchainTokenService = requiredEnv("INTERCHAIN_TOKEN_SERVICE");
  if (!ethers.isAddress(interchainTokenService)) throw new Error(`INTERCHAIN_TOKEN_SERVICE is not a valid address: ${interchainTokenService}`);
  const destinationChain = requiredEnv("XRPL_DESTINATION_CHAIN");

  const bandStdReference = optionalEnv("BAND_STD_REFERENCE", ethers.ZeroAddress);
  const closeFactorMantissa = parseScaled(optionalEnv("SECURD_CLOSE_FACTOR_MANTISSA", ethers.parseEther("0.5").toString()));
  const liquidationIncentiveMantissa = parseScaled(
    optionalEnv("SECURD_LIQUIDATION_INCENTIVE_MANTISSA", ethers.parseEther("1.08").toString())
  );
  const kink = parseScaled(optionalEnv("SECURD_IRM_KINK", ethers.parseEther("0.8").toString()));
  const baseRatePerYear = parseScaled(optionalEnv("SECURD_IRM_BASE_RATE_PER_YEAR", "0"));
  const multiplierPerYear = parseScaled(optionalEnv("SECURD_IRM_MULTIPLIER_PER_YEAR", "0"));
  const jumpMultiplierPerYear = parseScaled(optionalEnv("SECURD_IRM_JUMP_MULTIPLIER_PER_YEAR", "0"));
  const egressGasValue = parseOptionalScaled(process.env.XRPL_EGRESS_GAS_VALUE);
  const pauseGuardian = process.env.SECURD_PAUSE_GUARDIAN?.trim();
  const borrowCapGuardian = process.env.SECURD_BORROW_CAP_GUARDIAN?.trim();
  const deploymentOutputFile = process.env.DEPLOYMENT_OUTPUT_FILE?.trim();
  const comptrollerExpectedAdmin = process.env.SECURD_PENDING_ADMIN?.trim() || owner;
  const deployCollateralFactorTimelock = process.env.SECURD_DEPLOY_COLLATERAL_FACTOR_TIMELOCK !== "false";
  const deployMedianOracleReporter = process.env.SECURD_DEPLOY_MEDIAN_ORACLE_REPORTER === "true";
  const medianReporterOwner = process.env.SECURD_MEDIAN_REPORTER_OWNER?.trim() || owner;
  const medianReporterConfigRaw = process.env.SECURD_MEDIAN_REPORTER_CONFIG?.trim();
  const medianReporterReportersRaw = process.env.SECURD_MEDIAN_REPORTER_REPORTERS?.trim();

  const trustedGmpSources = loadTrustedGmpSourcesFromEnv();
  const trustedItsSources = loadTrustedItsSourcesFromEnv();
  const markets = loadMarketsFromEnv();

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Final owner: ${owner}`);

  const Oracle = await ethers.getContractFactory("SecurdPriceOracle");
  const oracle = await Oracle.deploy(deployer.address, bandStdReference);
  await oracle.waitForDeployment();

  const JumpRateModel = await ethers.getContractFactory("JumpRateModelV2");
  const interestRateModel = await JumpRateModel.deploy(
    baseRatePerYear,
    multiplierPerYear,
    jumpMultiplierPerYear,
    kink,
    deployer.address
  );
  await interestRateModel.waitForDeployment();

  const Comptroller = await ethers.getContractFactory("Comptroller");
  const comptrollerImplementation = await Comptroller.deploy();
  await comptrollerImplementation.waitForDeployment();

  const Unitroller = await ethers.getContractFactory("Unitroller");
  const unitroller = await Unitroller.deploy();
  await unitroller.waitForDeployment();

  await (await unitroller._setPendingImplementation(await comptrollerImplementation.getAddress())).wait();
  await (await comptrollerImplementation._become(await unitroller.getAddress())).wait();
  const comptroller = await ethers.getContractAt("Comptroller", await unitroller.getAddress());

  await (await comptroller._setPriceOracle(await oracle.getAddress())).wait();
  await (await comptroller._setCloseFactor(closeFactorMantissa)).wait();
  await (await comptroller._setLiquidationIncentive(liquidationIncentiveMantissa)).wait();

  if (pauseGuardian) {
    await (await comptroller._setPauseGuardian(pauseGuardian)).wait();
  }

  if (borrowCapGuardian) {
    await (await comptroller._setBorrowCapGuardian(borrowCapGuardian)).wait();
  }

  // Deploy the collateral-factor timelock unless explicitly disabled.
  // The timelock enforces a 48-hour delay on _setCollateralFactor changes so that borrowers
  // cannot be made immediately liquidatable by a retroactive collateral factor reduction.
  let collateralFactorTimelock:
    | ({
        waitForDeployment(): Promise<unknown>;
        getAddress(): Promise<string>;
        acceptUnitrollerAdmin(unitroller: string): Promise<{ wait(): Promise<unknown> }>;
        owner(): Promise<string>;
        transferOwnership(nextOwner: string): Promise<{ wait(): Promise<unknown> }>;
      })
    | undefined;
  if (deployCollateralFactorTimelock) {
    const TimelockFactory = await ethers.getContractFactory("SecurdCollateralFactorTimelock");
    collateralFactorTimelock = await TimelockFactory.deploy(deployer.address);
    await collateralFactorTimelock.waitForDeployment();
  }

  const Delegate = await ethers.getContractFactory("CErc20Delegate");
  const cErc20DelegateImplementation = await Delegate.deploy();
  await cErc20DelegateImplementation.waitForDeployment();

  const LiquidationKeeper = await ethers.getContractFactory("SecurdLiquidationKeeper");
  const liquidationKeeper = await LiquidationKeeper.deploy(deployer.address);
  await liquidationKeeper.waitForDeployment();

  let medianOracleReporter:
    | ({
        waitForDeployment(): Promise<unknown>;
        getAddress(): Promise<string>;
        setAssetConfig(asset: string, roundDuration: bigint, minSubmissions: number): Promise<{ wait(): Promise<unknown> }>;
        setReporter(asset: string, reporter: string, allowed: boolean): Promise<{ wait(): Promise<unknown> }>;
        owner(): Promise<string>;
        transferOwnership(nextOwner: string): Promise<{ wait(): Promise<unknown> }>;
      })
    | undefined;
  if (deployMedianOracleReporter) {
    const MedianOracleReporter = await ethers.getContractFactory("SecurdMedianOracleReporter");
    medianOracleReporter = await MedianOracleReporter.deploy(deployer.address, await oracle.getAddress());
    await medianOracleReporter.waitForDeployment();
  }

  const XRPLUserProxyFactory = await ethers.getContractFactory("XRPLUserProxyFactory");
  const proxyFactory = await XRPLUserProxyFactory.deploy(deployer.address, deployer.address);
  await proxyFactory.waitForDeployment();

  const XRPLBridgeAdapter = await ethers.getContractFactory("XRPLSecurdBridgeAdapter");
  const bridgeAdapter = await XRPLBridgeAdapter.deploy(
    deployer.address,
    axelarGateway,
    interchainTokenService,
    await proxyFactory.getAddress(),
    destinationChain
  );
  await bridgeAdapter.waitForDeployment();

  await (await proxyFactory.setController(await bridgeAdapter.getAddress())).wait();

  if (egressGasValue !== undefined) {
    await (await bridgeAdapter.setEgressGasValue(egressGasValue)).wait();
  }

  for (const source of trustedGmpSources) {
    await (await bridgeAdapter.setTrustedGmpSource(source.chain, source.address, true)).wait();
  }

  for (const source of trustedItsSources) {
    await (await bridgeAdapter.setTrustedItsSource(source.chain, encodeItsSourceAddress(source), true)).wait();
  }

  const Delegator = await ethers.getContractFactory("CErc20Delegator");
  const deployedMarkets: DeploymentSummary["markets"] = [];
  const borrowCapTargets: string[] = [];
  const borrowCaps: bigint[] = [];

  for (const market of markets) {
    const cToken = await Delegator.deploy(
      market.underlying,
      await unitroller.getAddress(),
      await interestRateModel.getAddress(),
      parseScaled(market.initialExchangeRateMantissa),
      market.cTokenName,
      market.cTokenSymbol,
      market.cTokenDecimals,
      owner,
      await cErc20DelegateImplementation.getAddress(),
      "0x"
    );
    await cToken.waitForDeployment();

    await (await comptroller._supportMarket(await cToken.getAddress())).wait();

    const oracleMode = market.oracle.type;
    if (oracleMode === "CHAINLINK") {
      if (!market.oracle.chainlinkFeed || !market.oracle.chainlinkHeartbeat) {
        throw new Error(`Missing Chainlink config for market ${market.cTokenSymbol}`);
      }
      await (
        await oracle.setChainlinkConfig(
          market.underlying,
          market.oracle.chainlinkFeed,
          BigInt(market.oracle.chainlinkHeartbeat)
        )
      ).wait();
    } else if (oracleMode === "BAND") {
      if (!market.oracle.bandBaseSymbol || !market.oracle.bandQuoteSymbol || !market.oracle.bandMaxDelay) {
        throw new Error(`Missing Band config for market ${market.cTokenSymbol}`);
      }
      await (
        await oracle.setBandConfig(
          market.underlying,
          market.oracle.bandBaseSymbol,
          market.oracle.bandQuoteSymbol,
          BigInt(market.oracle.bandMaxDelay)
        )
      ).wait();
    } else {
      if (!market.oracle.fallbackMaxDelay) {
        throw new Error(`Missing fallback config for market ${market.cTokenSymbol}`);
      }
      await (await oracle.setFallbackConfig(market.underlying, BigInt(market.oracle.fallbackMaxDelay))).wait();
      if (market.oracle.initialFallbackPrice) {
        await (await oracle.postFallbackPrice(market.underlying, BigInt(market.oracle.initialFallbackPrice))).wait();
      }
      if (medianOracleReporter) {
        await (await oracle.setAssetOracle(market.underlying, await medianOracleReporter.getAddress(), true)).wait();
      }
    }

    await (await oracle.setOracleType(market.underlying, toOracleType(oracleMode))).wait();
    await (await oracle.setCTokenUnderlying(await cToken.getAddress(), market.underlying)).wait();
    await (await comptroller._setCollateralFactor(await cToken.getAddress(), parseScaled(market.collateralFactorMantissa))).wait();

    if (market.borrowCap) {
      borrowCapTargets.push(await cToken.getAddress());
      borrowCaps.push(BigInt(market.borrowCap));
    }

    const bridgeListed = market.listOnBridge !== false;
    if (bridgeListed) {
      await (
        await bridgeAdapter.setMarket(await cToken.getAddress(), market.underlying, resolveBridgeTokenId(market), true)
      ).wait();
    }

    deployedMarkets.push({
      underlying: market.underlying,
      cToken: await cToken.getAddress(),
      cTokenSymbol: market.cTokenSymbol,
      bridgeListed,
      oracleMode
    });
  }

  if (medianOracleReporter && medianReporterConfigRaw) {
    const configs = safeParseJson<Array<{ asset: string; roundDuration: string; minSubmissions: number }>>(medianReporterConfigRaw, "SECURD_MEDIAN_REPORTER_CONFIG");
    for (const config of configs) {
      await (await medianOracleReporter.setAssetConfig(config.asset, BigInt(config.roundDuration), config.minSubmissions)).wait();
    }
  }

  if (medianOracleReporter && medianReporterReportersRaw) {
    const reporters = safeParseJson<Array<{ asset: string; reporter: string }>>(medianReporterReportersRaw, "SECURD_MEDIAN_REPORTER_REPORTERS");
    for (const reporterConfig of reporters) {
      await (await medianOracleReporter.setReporter(reporterConfig.asset, reporterConfig.reporter, true)).wait();
    }
  }

  if (borrowCapTargets.length > 0) {
    await (await comptroller._setMarketBorrowCaps(borrowCapTargets, borrowCaps)).wait();
  }

  // Wire the collateral-factor timelock as Unitroller admin so that all _setCollateralFactor
  // calls go through the 48-hour delay enforced by SecurdCollateralFactorTimelock.
  // The timelock itself is then owned by `owner` (the multisig).
  if (collateralFactorTimelock) {
    const timelockAddr = await collateralFactorTimelock.getAddress();
    await (await unitroller._setPendingAdmin(timelockAddr)).wait();
    await (await collateralFactorTimelock.acceptUnitrollerAdmin(await unitroller.getAddress())).wait();
    await maybeTransferOwnership(collateralFactorTimelock, owner);
  } else if (comptrollerExpectedAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await unitroller._setPendingAdmin(comptrollerExpectedAdmin)).wait();
  }

  const comptrollerAdmin = await unitroller.admin();
  const comptrollerPendingAdmin = await unitroller.pendingAdmin();

  await maybeTransferOwnership(oracle, owner);
  await maybeTransferOwnership(liquidationKeeper, owner);
  if (medianOracleReporter) {
    await maybeTransferOwnership(medianOracleReporter, medianReporterOwner);
  }
  await maybeTransferOwnership(proxyFactory, owner);
  await maybeTransferOwnership(bridgeAdapter, owner);

  const summary: DeploymentSummary = {
    owner,
    deployer: deployer.address,
    comptrollerAdmin,
    comptrollerPendingAdmin,
    comptrollerExpectedAdmin,
    unitroller: await unitroller.getAddress(),
    comptrollerImplementation: await comptrollerImplementation.getAddress(),
    comptrollerProxy: await unitroller.getAddress(),
    collateralFactorTimelock: collateralFactorTimelock ? await collateralFactorTimelock.getAddress() : undefined,
    oracle: await oracle.getAddress(),
    interestRateModel: await interestRateModel.getAddress(),
    cErc20DelegateImplementation: await cErc20DelegateImplementation.getAddress(),
    liquidationKeeper: await liquidationKeeper.getAddress(),
    medianOracleReporter: medianOracleReporter ? await medianOracleReporter.getAddress() : undefined,
    xrplUserProxyFactory: await proxyFactory.getAddress(),
    xrplBridgeAdapter: await bridgeAdapter.getAddress(),
    markets: deployedMarkets
  };

  console.log(JSON.stringify(summary, null, 2));
  if (comptrollerPendingAdmin !== ethers.ZeroAddress) {
    console.log("Note: Unitroller admin handoff is pending; the pending admin must call _acceptAdmin() on Unitroller.");
  }

  if (deploymentOutputFile) {
    const resolved = confinedOutputPath(deploymentOutputFile);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Deployment summary written to ${resolved}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
