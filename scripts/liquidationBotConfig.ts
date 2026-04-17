import fs from "fs";
import path from "path";

export type ExecutorType = "wrapper" | "wallet";
export type OracleMode = "CHAINLINK" | "BAND" | "FALLBACK";
export type GasPriceStrategy = "bounded-escalation" | "fixed" | "oracle";

export interface LiquidationBotNetworkConfig {
  name: string;
  chainId: number;
  rpcUrls: string[];
  finalityConfirmations: number;
}

export interface LiquidationBotProtocolConfig {
  unitroller: string;
  comptroller: string;
  oracle: string;
  keeperWrapper: string;
}

export interface LiquidationBotWalletConfig {
  name: string;
  address: string;
  executorType: ExecutorType;
}

export interface LiquidationBotProfitabilityConfig {
  minimumProfitUsd: string;
  gasCostUsdBuffer: string;
  operationalBufferUsd: string;
}

export interface LiquidationBotRiskConfig {
  maxConcurrentLiquidations: number;
  maxRepayUsdPerTx: string;
  maxRepayUsdPerAsset: Record<string, string>;
  maxCollateralExposureUsd: {
    standard: string;
    lp_fallback: string;
  };
}

export interface LiquidationBotOraclePolicies {
  chainlinkMaxAgeSeconds: number;
  bandMaxAgeSeconds: number;
  fallbackDefaultMaxAgeSeconds: number;
  requireNonZeroPrice: boolean;
}

export interface LiquidationBotAssetPolicy {
  symbol: string;
  underlying: string;
  borrowedMarket: string;
  internalHaircutBps: number;
  maxRepayAmount: string;
  allowAsRepayAsset: boolean;
  allowAsSeizedCollateral: boolean;
  oracleMode: OracleMode;
  fallbackMaxAgeSeconds?: number;
  requireManualReviewAboveUsd?: string;
}

export interface LiquidationBotAlertsConfig {
  webhookUrl: string;
  emailRecipients: string[];
}

export interface LiquidationBotExecutionConfig {
  gasPriceStrategy: GasPriceStrategy;
  gasLimitBufferBps: number;
  retryOnReplacementUnderpriced: boolean;
  retryOnNonceTooLow: boolean;
}

export interface LiquidationBotConfig {
  network: LiquidationBotNetworkConfig;
  protocol: LiquidationBotProtocolConfig;
  wallets: LiquidationBotWalletConfig[];
  profitability: LiquidationBotProfitabilityConfig;
  risk: LiquidationBotRiskConfig;
  oraclePolicies: LiquidationBotOraclePolicies;
  assetPolicies: LiquidationBotAssetPolicy[];
  alerts: LiquidationBotAlertsConfig;
  execution: LiquidationBotExecutionConfig;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid liquidation bot config: ${message}`);
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

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  assert(typeof value === "boolean", `${field} must be a boolean`);
}

function assertStringRecord(value: unknown, field: string): asserts value is Record<string, string> {
  assert(isObject(value), `${field} must be an object`);
  for (const [key, entry] of Object.entries(value)) {
    assertString(key, `${field} key`);
    assertString(entry, `${field}.${key}`);
  }
}

export function parseLiquidationBotConfig(input: unknown): LiquidationBotConfig {
  assert(isObject(input), "root must be an object");

  const { network, protocol, wallets, profitability, risk, oraclePolicies, assetPolicies, alerts, execution } = input;

  assert(isObject(network), "network must be an object");
  assertString(network.name, "network.name");
  assertNumber(network.chainId, "network.chainId");
  assert(Array.isArray(network.rpcUrls) && network.rpcUrls.length > 0, "network.rpcUrls must be a non-empty array");
  network.rpcUrls.forEach((url, index) => assertString(url, `network.rpcUrls[${index}]`));
  assertNumber(network.finalityConfirmations, "network.finalityConfirmations");

  assert(isObject(protocol), "protocol must be an object");
  assertString(protocol.unitroller, "protocol.unitroller");
  assertString(protocol.comptroller, "protocol.comptroller");
  assertString(protocol.oracle, "protocol.oracle");
  assertString(protocol.keeperWrapper, "protocol.keeperWrapper");

  assert(Array.isArray(wallets) && wallets.length > 0, "wallets must be a non-empty array");
  wallets.forEach((wallet, index) => {
    assert(isObject(wallet), `wallets[${index}] must be an object`);
    assertString(wallet.name, `wallets[${index}].name`);
    assertString(wallet.address, `wallets[${index}].address`);
    assert(wallet.executorType === "wrapper" || wallet.executorType === "wallet", `wallets[${index}].executorType invalid`);
  });

  assert(isObject(profitability), "profitability must be an object");
  assertString(profitability.minimumProfitUsd, "profitability.minimumProfitUsd");
  assertString(profitability.gasCostUsdBuffer, "profitability.gasCostUsdBuffer");
  assertString(profitability.operationalBufferUsd, "profitability.operationalBufferUsd");

  assert(isObject(risk), "risk must be an object");
  assertNumber(risk.maxConcurrentLiquidations, "risk.maxConcurrentLiquidations");
  assertString(risk.maxRepayUsdPerTx, "risk.maxRepayUsdPerTx");
  assertStringRecord(risk.maxRepayUsdPerAsset, "risk.maxRepayUsdPerAsset");
  assert(isObject(risk.maxCollateralExposureUsd), "risk.maxCollateralExposureUsd must be an object");
  assertString(risk.maxCollateralExposureUsd.standard, "risk.maxCollateralExposureUsd.standard");
  assertString(risk.maxCollateralExposureUsd.lp_fallback, "risk.maxCollateralExposureUsd.lp_fallback");

  assert(isObject(oraclePolicies), "oraclePolicies must be an object");
  assertNumber(oraclePolicies.chainlinkMaxAgeSeconds, "oraclePolicies.chainlinkMaxAgeSeconds");
  assertNumber(oraclePolicies.bandMaxAgeSeconds, "oraclePolicies.bandMaxAgeSeconds");
  assertNumber(oraclePolicies.fallbackDefaultMaxAgeSeconds, "oraclePolicies.fallbackDefaultMaxAgeSeconds");
  assertBoolean(oraclePolicies.requireNonZeroPrice, "oraclePolicies.requireNonZeroPrice");

  assert(Array.isArray(assetPolicies) && assetPolicies.length > 0, "assetPolicies must be a non-empty array");
  assetPolicies.forEach((policy, index) => {
    assert(isObject(policy), `assetPolicies[${index}] must be an object`);
    assertString(policy.symbol, `assetPolicies[${index}].symbol`);
    assertString(policy.underlying, `assetPolicies[${index}].underlying`);
    assertString(policy.borrowedMarket, `assetPolicies[${index}].borrowedMarket`);
    assertNumber(policy.internalHaircutBps, `assetPolicies[${index}].internalHaircutBps`);
    assertString(policy.maxRepayAmount, `assetPolicies[${index}].maxRepayAmount`);
    assertBoolean(policy.allowAsRepayAsset, `assetPolicies[${index}].allowAsRepayAsset`);
    assertBoolean(policy.allowAsSeizedCollateral, `assetPolicies[${index}].allowAsSeizedCollateral`);
    assert(
      policy.oracleMode === "CHAINLINK" || policy.oracleMode === "BAND" || policy.oracleMode === "FALLBACK",
      `assetPolicies[${index}].oracleMode invalid`
    );
    if (policy.fallbackMaxAgeSeconds !== undefined) {
      assertNumber(policy.fallbackMaxAgeSeconds, `assetPolicies[${index}].fallbackMaxAgeSeconds`);
    }
    if (policy.requireManualReviewAboveUsd !== undefined) {
      assertString(policy.requireManualReviewAboveUsd, `assetPolicies[${index}].requireManualReviewAboveUsd`);
    }
  });

  assert(isObject(alerts), "alerts must be an object");
  assertString(alerts.webhookUrl, "alerts.webhookUrl");
  assert(Array.isArray(alerts.emailRecipients), "alerts.emailRecipients must be an array");
  alerts.emailRecipients.forEach((entry, index) => assertString(entry, `alerts.emailRecipients[${index}]`));

  assert(isObject(execution), "execution must be an object");
  assert(
    execution.gasPriceStrategy === "bounded-escalation"
      || execution.gasPriceStrategy === "fixed"
      || execution.gasPriceStrategy === "oracle",
    "execution.gasPriceStrategy invalid"
  );
  assertNumber(execution.gasLimitBufferBps, "execution.gasLimitBufferBps");
  assertBoolean(execution.retryOnReplacementUnderpriced, "execution.retryOnReplacementUnderpriced");
  assertBoolean(execution.retryOnNonceTooLow, "execution.retryOnNonceTooLow");

  return input as unknown as LiquidationBotConfig;
}

export function loadLiquidationBotConfig(configPath: string): LiquidationBotConfig {
  const resolvedPath = path.resolve(configPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  return parseLiquidationBotConfig(JSON.parse(raw));
}
