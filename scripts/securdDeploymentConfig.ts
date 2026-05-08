import fs from "fs";
import path from "path";
import { ethers } from "ethers";

export type OracleMode = "CHAINLINK" | "BAND" | "FALLBACK";
export type TrustedSourceEncoding = "utf8" | "hex";

export interface TrustedGmpSourceConfig {
  chain: string;
  address: string;
}

export interface TrustedItsSourceConfig {
  chain: string;
  address: string;
  encoding?: TrustedSourceEncoding;
}

export interface MarketOracleConfig {
  type: OracleMode;
  chainlinkFeed?: string;
  chainlinkHeartbeat?: string;
  bandBaseSymbol?: string;
  bandQuoteSymbol?: string;
  bandMaxDelay?: string;
  fallbackMaxDelay?: string;
  initialFallbackPrice?: string;
}

export interface MarketConfig {
  underlying: string;
  cTokenName: string;
  cTokenSymbol: string;
  cTokenDecimals: number;
  initialExchangeRateMantissa: string;
  collateralFactorMantissa: string;
  borrowCap?: string;
  bridgeTokenId?: string;
  bridgeTokenIdLabel?: string;
  listOnBridge?: boolean;
  oracle: MarketOracleConfig;
}

export interface DeploymentSummaryMarket {
  underlying: string;
  cToken: string;
  cTokenSymbol: string;
  bridgeListed: boolean;
  oracleMode: OracleMode;
}

export interface DeploymentSummary {
  owner: string;
  deployer: string;
  comptrollerAdmin: string;
  comptrollerPendingAdmin: string;
  comptrollerExpectedAdmin: string;
  unitroller: string;
  comptrollerImplementation: string;
  comptrollerProxy: string;
  collateralFactorTimelock?: string;
  oracle: string;
  interestRateModel: string;
  cErc20DelegateImplementation: string;
  liquidationKeeper: string;
  medianOracleReporter?: string;
  xrplUserProxyFactory: string;
  xrplBridgeAdapter: string;
  markets: DeploymentSummaryMarket[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid Securd deployment data: ${message}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  assert(typeof value === "string" && value.trim().length > 0, `${field} must be a non-empty string`);
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  assert(typeof value === "boolean", `${field} must be a boolean`);
}

function assertNumber(value: unknown, field: string): asserts value is number {
  assert(typeof value === "number" && Number.isFinite(value), `${field} must be a finite number`);
}

function assertAddress(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  assert(ethers.isAddress(value), `${field} must be a valid address`);
}

function assertOptionalScaled(value: unknown, field: string) {
  if (value === undefined) {
    return;
  }
  assertString(value, field);
  assert(/^\d+$/.test(value), `${field} must be a base-10 integer string`);
}

export function parseTrustedGmpSources(input: unknown): TrustedGmpSourceConfig[] {
  assert(Array.isArray(input), "trusted GMP sources must be an array");
  input.forEach((entry, index) => {
    assert(isObject(entry), `trustedGmpSources[${index}] must be an object`);
    assertString(entry.chain, `trustedGmpSources[${index}].chain`);
    assertString(entry.address, `trustedGmpSources[${index}].address`);
  });
  return input as TrustedGmpSourceConfig[];
}

export function parseTrustedItsSources(input: unknown): TrustedItsSourceConfig[] {
  assert(Array.isArray(input), "trusted ITS sources must be an array");
  input.forEach((entry, index) => {
    assert(isObject(entry), `trustedItsSources[${index}] must be an object`);
    assertString(entry.chain, `trustedItsSources[${index}].chain`);
    assertString(entry.address, `trustedItsSources[${index}].address`);
    if (entry.encoding !== undefined) {
      assert(entry.encoding === "utf8" || entry.encoding === "hex", `trustedItsSources[${index}].encoding invalid`);
    }
  });
  return input as TrustedItsSourceConfig[];
}

function parseMarketOracleConfig(input: unknown, field: string): MarketOracleConfig {
  assert(isObject(input), `${field} must be an object`);
  assert(input.type === "CHAINLINK" || input.type === "BAND" || input.type === "FALLBACK", `${field}.type invalid`);

  if (input.type === "CHAINLINK") {
    assertAddress(input.chainlinkFeed, `${field}.chainlinkFeed`);
    assertOptionalScaled(input.chainlinkHeartbeat, `${field}.chainlinkHeartbeat`);
    assert(input.chainlinkHeartbeat !== undefined, `${field}.chainlinkHeartbeat required for CHAINLINK`);
  } else if (input.type === "BAND") {
    assertString(input.bandBaseSymbol, `${field}.bandBaseSymbol`);
    assertString(input.bandQuoteSymbol, `${field}.bandQuoteSymbol`);
    assertOptionalScaled(input.bandMaxDelay, `${field}.bandMaxDelay`);
    assert(input.bandMaxDelay !== undefined, `${field}.bandMaxDelay required for BAND`);
  } else {
    assertOptionalScaled(input.fallbackMaxDelay, `${field}.fallbackMaxDelay`);
    assert(input.fallbackMaxDelay !== undefined, `${field}.fallbackMaxDelay required for FALLBACK`);
    assertOptionalScaled(input.initialFallbackPrice, `${field}.initialFallbackPrice`);
  }

  return input as unknown as MarketOracleConfig;
}

export function parseMarketConfigArray(input: unknown): MarketConfig[] {
  assert(Array.isArray(input), "markets config must be an array");
  input.forEach((entry, index) => {
    assert(isObject(entry), `markets[${index}] must be an object`);
    assertAddress(entry.underlying, `markets[${index}].underlying`);
    assertString(entry.cTokenName, `markets[${index}].cTokenName`);
    assertString(entry.cTokenSymbol, `markets[${index}].cTokenSymbol`);
    assertNumber(entry.cTokenDecimals, `markets[${index}].cTokenDecimals`);
    assertOptionalScaled(entry.initialExchangeRateMantissa, `markets[${index}].initialExchangeRateMantissa`);
    assertOptionalScaled(entry.collateralFactorMantissa, `markets[${index}].collateralFactorMantissa`);
    assertOptionalScaled(entry.borrowCap, `markets[${index}].borrowCap`);
    if (entry.bridgeTokenId !== undefined) {
      assertString(entry.bridgeTokenId, `markets[${index}].bridgeTokenId`);
      assert(/^0x[0-9a-fA-F]{64}$/.test(entry.bridgeTokenId), `markets[${index}].bridgeTokenId must be bytes32 hex`);
    }
    if (entry.bridgeTokenIdLabel !== undefined) {
      assertString(entry.bridgeTokenIdLabel, `markets[${index}].bridgeTokenIdLabel`);
    }
    if (entry.listOnBridge !== undefined) {
      assertBoolean(entry.listOnBridge, `markets[${index}].listOnBridge`);
    }
    parseMarketOracleConfig(entry.oracle, `markets[${index}].oracle`);
  });
  return input as unknown as MarketConfig[];
}

export function parseDeploymentSummary(input: unknown): DeploymentSummary {
  assert(isObject(input), "deployment summary root must be an object");
  assertAddress(input.owner, "owner");
  assertAddress(input.deployer, "deployer");
  assertAddress(input.comptrollerAdmin, "comptrollerAdmin");
  assertAddress(input.comptrollerPendingAdmin, "comptrollerPendingAdmin");
  assertAddress(input.comptrollerExpectedAdmin, "comptrollerExpectedAdmin");
  assertAddress(input.unitroller, "unitroller");
  assertAddress(input.comptrollerImplementation, "comptrollerImplementation");
  assertAddress(input.comptrollerProxy, "comptrollerProxy");
  assertAddress(input.oracle, "oracle");
  assertAddress(input.interestRateModel, "interestRateModel");
  assertAddress(input.cErc20DelegateImplementation, "cErc20DelegateImplementation");
  assertAddress(input.liquidationKeeper, "liquidationKeeper");
  if (input.medianOracleReporter !== undefined) {
    assertAddress(input.medianOracleReporter, "medianOracleReporter");
  }
  assertAddress(input.xrplUserProxyFactory, "xrplUserProxyFactory");
  assertAddress(input.xrplBridgeAdapter, "xrplBridgeAdapter");
  assert(Array.isArray(input.markets), "markets must be an array");

  input.markets.forEach((entry, index) => {
    assert(isObject(entry), `markets[${index}] must be an object`);
    assertAddress(entry.underlying, `markets[${index}].underlying`);
    assertAddress(entry.cToken, `markets[${index}].cToken`);
    assertString(entry.cTokenSymbol, `markets[${index}].cTokenSymbol`);
    assertBoolean(entry.bridgeListed, `markets[${index}].bridgeListed`);
    assert(
      entry.oracleMode === "CHAINLINK" || entry.oracleMode === "BAND" || entry.oracleMode === "FALLBACK",
      `markets[${index}].oracleMode invalid`
    );
  });

  return input as unknown as DeploymentSummary;
}

export function loadJson<T>(configPath: string): T {
  const resolvedPath = path.resolve(configPath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as T;
}

export function loadTrustedGmpSources(configPath: string): TrustedGmpSourceConfig[] {
  return parseTrustedGmpSources(loadJson(configPath));
}

export function loadTrustedItsSources(configPath: string): TrustedItsSourceConfig[] {
  return parseTrustedItsSources(loadJson(configPath));
}

export function loadMarketConfigArray(configPath: string): MarketConfig[] {
  return parseMarketConfigArray(loadJson(configPath));
}

export function loadDeploymentSummary(configPath: string): DeploymentSummary {
  return parseDeploymentSummary(loadJson(configPath));
}
