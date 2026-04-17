import fs from "fs";
import path from "path";

export interface XrplLpOracleRpcConfig {
  xrplRpcUrl: string;
  xrplEvmRpcUrl: string;
}

export interface XrplLpOracleWalletConfig {
  publisherPrivateKeyEnv: string;
}

export interface XrplLpOracleDefaultsConfig {
  pollIntervalMs: number;
  publishIntervalSec: number;
  minDeviationBps: number;
  maxPriceAgeSec: number;
  maxReserveJumpBps: number;
  maxStepUpBps: number;
  maxStepDownBps: number;
}

export interface XrplLpOracleAlertsConfig {
  webhookUrlEnv?: string;
  logErrors?: boolean;
}

export interface XrplAssetDescriptor {
  currency: string;
  issuer?: string;
}

export interface XrplLpOraclePoolXrplConfig {
  asset0: XrplAssetDescriptor;
  asset1: XrplAssetDescriptor;
}

export interface XrplLpOraclePoolEvmConfig {
  collateralAsset: string;
  underlyingDecimals: number;
  token0: string;
  token1: string;
}

export interface XrplLpOraclePoolRiskConfig {
  haircutBps: number;
  minTvlUsd: string;
  maxTokenWeightBps: number;
}

export interface XrplLpOraclePoolConfig {
  name: string;
  xrpl: XrplLpOraclePoolXrplConfig;
  evm: XrplLpOraclePoolEvmConfig;
  risk: XrplLpOraclePoolRiskConfig;
}

export interface XrplLpOracleConfig {
  rpc: XrplLpOracleRpcConfig;
  wallet: XrplLpOracleWalletConfig;
  defaults: XrplLpOracleDefaultsConfig;
  alerts?: XrplLpOracleAlertsConfig;
  pools: XrplLpOraclePoolConfig[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid XRPL LP oracle config: ${message}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  assert(typeof value === "string" && value.length > 0, `${field} must be a non-empty string`);
}

function assertNumber(value: unknown, field: string): asserts value is number {
  assert(typeof value === "number" && Number.isFinite(value), `${field} must be a finite number`);
}

function assertAddress(value: unknown, field: string): asserts value is string {
  assert(typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value), `${field} must be a valid address`);
}

function assertNumericString(value: unknown, field: string): asserts value is string {
  assert(typeof value === "string" && /^\d+(\.\d+)?$/.test(value), `${field} must be a numeric string`);
}

function assertXrplAsset(value: unknown, field: string): asserts value is XrplAssetDescriptor {
  assert(isObject(value), `${field} must be an object`);
  assertString(value.currency, `${field}.currency`);
  if (value.currency !== "XRP") {
    assertString(value.issuer, `${field}.issuer`);
  }
}

export function parseXrplLpOracleConfig(input: unknown): XrplLpOracleConfig {
  assert(isObject(input), "root must be an object");

  const { rpc, wallet, defaults, alerts, pools } = input;

  assert(isObject(rpc), "rpc must be an object");
  assertString(rpc.xrplRpcUrl, "rpc.xrplRpcUrl");
  assertString(rpc.xrplEvmRpcUrl, "rpc.xrplEvmRpcUrl");

  assert(isObject(wallet), "wallet must be an object");
  assertString(wallet.publisherPrivateKeyEnv, "wallet.publisherPrivateKeyEnv");

  assert(isObject(defaults), "defaults must be an object");
  assertNumber(defaults.pollIntervalMs, "defaults.pollIntervalMs");
  assertNumber(defaults.publishIntervalSec, "defaults.publishIntervalSec");
  assertNumber(defaults.minDeviationBps, "defaults.minDeviationBps");
  assertNumber(defaults.maxPriceAgeSec, "defaults.maxPriceAgeSec");
  assertNumber(defaults.maxReserveJumpBps, "defaults.maxReserveJumpBps");
  assertNumber(defaults.maxStepUpBps, "defaults.maxStepUpBps");
  assertNumber(defaults.maxStepDownBps, "defaults.maxStepDownBps");

  if (alerts !== undefined) {
    assert(isObject(alerts), "alerts must be an object");
    if (alerts.webhookUrlEnv !== undefined) {
      assertString(alerts.webhookUrlEnv, "alerts.webhookUrlEnv");
    }
    if (alerts.logErrors !== undefined) {
      assert(typeof alerts.logErrors === "boolean", "alerts.logErrors must be a boolean");
    }
  }

  assert(Array.isArray(pools) && pools.length > 0, "pools must be a non-empty array");
  pools.forEach((pool, index) => {
    assert(isObject(pool), `pools[${index}] must be an object`);
    assertString(pool.name, `pools[${index}].name`);

    assert(isObject(pool.xrpl), `pools[${index}].xrpl must be an object`);
    assertXrplAsset(pool.xrpl.asset0, `pools[${index}].xrpl.asset0`);
    assertXrplAsset(pool.xrpl.asset1, `pools[${index}].xrpl.asset1`);

    assert(isObject(pool.evm), `pools[${index}].evm must be an object`);
    assertAddress(pool.evm.collateralAsset, `pools[${index}].evm.collateralAsset`);
    assertNumber(pool.evm.underlyingDecimals, `pools[${index}].evm.underlyingDecimals`);
    assert(pool.evm.underlyingDecimals >= 0 && pool.evm.underlyingDecimals <= 36, `pools[${index}].evm.underlyingDecimals out of range`);
    assertAddress(pool.evm.token0, `pools[${index}].evm.token0`);
    assertAddress(pool.evm.token1, `pools[${index}].evm.token1`);

    assert(isObject(pool.risk), `pools[${index}].risk must be an object`);
    assertNumber(pool.risk.haircutBps, `pools[${index}].risk.haircutBps`);
    assert(pool.risk.haircutBps >= 0 && pool.risk.haircutBps < 10_000, `pools[${index}].risk.haircutBps out of range`);
    assertNumericString(pool.risk.minTvlUsd, `pools[${index}].risk.minTvlUsd`);
    assertNumber(pool.risk.maxTokenWeightBps, `pools[${index}].risk.maxTokenWeightBps`);
    assert(
      pool.risk.maxTokenWeightBps > 0 && pool.risk.maxTokenWeightBps <= 10_000,
      `pools[${index}].risk.maxTokenWeightBps out of range`
    );
  });

  return input as unknown as XrplLpOracleConfig;
}

export function loadXrplLpOracleConfig(configPath: string): XrplLpOracleConfig {
  const resolvedPath = path.resolve(configPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  return parseXrplLpOracleConfig(JSON.parse(raw));
}
