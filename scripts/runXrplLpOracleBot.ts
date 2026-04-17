import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { loadXrplLpOracleConfig, XrplAssetDescriptor, XrplLpOraclePoolConfig } from "./xrplLpOracleConfig";

const ORACLE_ABI = [
  "function previewPrices(address asset) view returns (uint8 oracleType,uint256 chainlinkPriceMantissa,uint256 bandPriceMantissa,uint256 fallbackPriceMantissa,uint256 selectedPriceMantissa)",
  "function postFallbackPrice(address asset, uint256 priceMantissa) external"
];

interface BotStateEntry {
  lastPublishedMantissa?: string;
  lastPublishedAt?: number;
  lastObservedMantissa?: string;
  lastObservedAt?: number;
  lastReserve0E18?: string;
  lastReserve1E18?: string;
  lastError?: string;
}

interface BotState {
  pools: Record<string, BotStateEntry>;
}

interface XrplAmountObject {
  currency: string;
  issuer?: string;
  value: string;
}

interface AmmInfoResponse {
  result?: {
    amm?: {
      amount: string | XrplAmountObject;
      amount2: string | XrplAmountObject;
      lp_token: XrplAmountObject;
      trading_fee?: number;
    };
    validated?: boolean;
    ledger_index?: number;
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function bigIntPow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}

export function parseDecimalToE18(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = `${fraction}000000000000000000`.slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(normalizedFraction || "0");
}

export function normalizeXrplAmount(amount: string | XrplAmountObject): bigint {
  if (typeof amount === "string") {
    return BigInt(amount) * 10n ** 12n;
  }
  return parseDecimalToE18(amount.value);
}

export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  return (a * b) / denominator;
}

export function absDiffBps(nextValue: bigint, prevValue: bigint): bigint {
  if (prevValue === 0n) {
    return 10_000n;
  }
  const diff = nextValue > prevValue ? nextValue - prevValue : prevValue - nextValue;
  return (diff * 10_000n) / prevValue;
}

function assetKey(asset: XrplAssetDescriptor): string {
  return asset.currency === "XRP" ? "XRP" : `${asset.currency}:${asset.issuer ?? ""}`;
}

async function fetchAmmInfo(rpcUrl: string, pool: XrplLpOraclePoolConfig): Promise<AmmInfoResponse> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "amm_info",
      params: [
        {
          asset: pool.xrpl.asset0.currency === "XRP" ? { currency: "XRP" } : pool.xrpl.asset0,
          asset2: pool.xrpl.asset1.currency === "XRP" ? { currency: "XRP" } : pool.xrpl.asset1,
          ledger_index: "validated"
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`XRPL amm_info request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<AmmInfoResponse>;
}

async function readUnderlyingPrice(oracle: ethers.Contract, asset: string): Promise<bigint> {
  const [, , , , selectedPriceMantissa] = await oracle.previewPrices(asset);
  const price = BigInt(selectedPriceMantissa.toString());
  if (price === 0n) {
    throw new Error(`No trusted underlying price available for ${asset}`);
  }
  return price;
}

export function computePublishedPriceMantissa(
  reserve0E18: bigint,
  reserve1E18: bigint,
  price0E18: bigint,
  price1E18: bigint,
  lpSupplyE18: bigint,
  haircutBps: number,
  underlyingDecimals: number
): bigint {
  const poolValueE18 = mulDiv(reserve0E18, price0E18, 10n ** 18n) + mulDiv(reserve1E18, price1E18, 10n ** 18n);
  const rawLpPriceE18 = mulDiv(poolValueE18, 10n ** 18n, lpSupplyE18);
  const haircutPriceE18 = mulDiv(rawLpPriceE18, BigInt(10_000 - haircutBps), 10_000n);

  if (underlyingDecimals <= 18) {
    return haircutPriceE18 * bigIntPow10(18 - underlyingDecimals);
  }

  return haircutPriceE18 / bigIntPow10(underlyingDecimals - 18);
}

function loadState(statePath: string): BotState {
  if (!fs.existsSync(statePath)) {
    return { pools: {} };
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as BotState;
}

function saveState(statePath: string, state: BotState): void {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function shouldPublish(
  pool: XrplLpOraclePoolConfig,
  state: BotState,
  nextMantissa: bigint,
  now: number,
  publishIntervalSec: number,
  minDeviationBps: number
): boolean {
  const last = state.pools[pool.name];
  if (!last?.lastPublishedMantissa || !last.lastPublishedAt) {
    return true;
  }

  const lastMantissa = BigInt(last.lastPublishedMantissa);
  const elapsed = now - last.lastPublishedAt;
  const deviationBps = absDiffBps(nextMantissa, lastMantissa);

  return elapsed >= publishIntervalSec || deviationBps >= BigInt(minDeviationBps);
}

export function exceedsReserveJumpBps(currentValue: bigint, previousValue?: bigint, maxReserveJumpBps?: number): boolean {
  if (!previousValue || previousValue === 0n || maxReserveJumpBps === undefined) {
    return false;
  }
  return absDiffBps(currentValue, previousValue) > BigInt(maxReserveJumpBps);
}

function appendErrorState(state: BotState, poolName: string, message: string): void {
  state.pools[poolName] = {
    ...state.pools[poolName],
    lastError: message
  };
}

async function sendAlert(config: ReturnType<typeof loadXrplLpOracleConfig>, message: string): Promise<void> {
  if (config.alerts?.logErrors !== false) {
    console.error(`[alert] ${message}`);
  }

  if (!config.alerts?.webhookUrlEnv) {
    return;
  }

  const webhookUrl = process.env[config.alerts.webhookUrlEnv];
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message })
    });
  } catch (error) {
    console.error("[alert-failed]", error);
  }
}

async function processPool(
  configPath: string,
  pool: XrplLpOraclePoolConfig,
  oracle: ethers.Contract,
  state: BotState,
  wallet: ethers.Wallet,
  defaults: { publishIntervalSec: number; minDeviationBps: number }
): Promise<void> {
  const config = loadXrplLpOracleConfig(configPath);
  const ammInfo = await fetchAmmInfo(config.rpc.xrplRpcUrl, pool);

  if (!ammInfo.result?.validated || !ammInfo.result.amm) {
    throw new Error(`AMM state is not validated for pool ${pool.name}`);
  }

  const reserve0E18 = normalizeXrplAmount(ammInfo.result.amm.amount);
  const reserve1E18 = normalizeXrplAmount(ammInfo.result.amm.amount2);
  const lpSupplyE18 = normalizeXrplAmount(ammInfo.result.amm.lp_token);
  if (reserve0E18 === 0n || reserve1E18 === 0n || lpSupplyE18 === 0n) {
    throw new Error(`Invalid reserve or LP supply state for pool ${pool.name}`);
  }

  const price0E18 = await readUnderlyingPrice(oracle, pool.evm.token0);
  const price1E18 = await readUnderlyingPrice(oracle, pool.evm.token1);
  const tvl0E18 = mulDiv(reserve0E18, price0E18, 10n ** 18n);
  const tvl1E18 = mulDiv(reserve1E18, price1E18, 10n ** 18n);
  const totalTvlUsdE18 = tvl0E18 + tvl1E18;
  const minTvlUsdE18 = parseDecimalToE18(pool.risk.minTvlUsd);
  if (totalTvlUsdE18 < minTvlUsdE18) {
    throw new Error(`Pool ${pool.name} TVL below threshold`);
  }

  const maxWeight = BigInt(pool.risk.maxTokenWeightBps);
  const weight0Bps = (tvl0E18 * 10_000n) / totalTvlUsdE18;
  const weight1Bps = (tvl1E18 * 10_000n) / totalTvlUsdE18;
  if (weight0Bps > maxWeight || weight1Bps > maxWeight) {
    throw new Error(`Pool ${pool.name} concentration exceeds threshold`);
  }

  const previous = state.pools[pool.name];
  const previousReserve0 = previous?.lastReserve0E18 ? BigInt(previous.lastReserve0E18) : undefined;
  const previousReserve1 = previous?.lastReserve1E18 ? BigInt(previous.lastReserve1E18) : undefined;
  if (
    exceedsReserveJumpBps(reserve0E18, previousReserve0, config.defaults.maxReserveJumpBps)
    || exceedsReserveJumpBps(reserve1E18, previousReserve1, config.defaults.maxReserveJumpBps)
  ) {
    throw new Error(`Pool ${pool.name} reserve jump exceeds threshold`);
  }

  const nextMantissa = computePublishedPriceMantissa(
    reserve0E18,
    reserve1E18,
    price0E18,
    price1E18,
    lpSupplyE18,
    pool.risk.haircutBps,
    pool.evm.underlyingDecimals
  );

  const now = Math.floor(Date.now() / 1000);
  state.pools[pool.name] = {
    ...state.pools[pool.name],
    lastObservedMantissa: nextMantissa.toString(),
    lastObservedAt: now,
    lastReserve0E18: reserve0E18.toString(),
    lastReserve1E18: reserve1E18.toString(),
    lastError: undefined
  };

  if (!shouldPublish(pool, state, nextMantissa, now, defaults.publishIntervalSec, defaults.minDeviationBps)) {
    console.log(`[skip] ${pool.name}: publish conditions not met`);
    return;
  }

  const publisher = oracle.connect(wallet) as ethers.Contract & {
    postFallbackPrice: (asset: string, priceMantissa: bigint) => Promise<ethers.TransactionResponse>;
  };
  const tx = await publisher.postFallbackPrice(pool.evm.collateralAsset, nextMantissa);
  const receipt = await tx.wait();

  state.pools[pool.name] = {
    lastPublishedMantissa: nextMantissa.toString(),
    lastPublishedAt: now
  };

  console.log(`[publish] ${pool.name}: price=${nextMantissa.toString()} tx=${receipt?.hash ?? tx.hash}`);
}

export async function main() {
  const configPath = process.argv[2] || "config/xrpl-lp-oracle.example.json";
  const resolvedConfigPath = path.resolve(configPath);
  const config = loadXrplLpOracleConfig(resolvedConfigPath);
  const privateKey = requiredEnv(config.wallet.publisherPrivateKeyEnv);
  const provider = new ethers.JsonRpcProvider(config.rpc.xrplEvmRpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const oracleAddress = requiredEnv("LP_ORACLE_CONTRACT");
  const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);
  const statePath = path.resolve(process.env.LP_ORACLE_STATE_PATH || "./tmp/xrpl-lp-oracle-state.json");
  const state = loadState(statePath);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  console.log(`Publisher: ${wallet.address}`);
  console.log(`Oracle: ${oracleAddress}`);
  console.log(`Pools: ${config.pools.length}`);

  const runOnce = process.env.LP_ORACLE_ONCE === "true";

  do {
    for (const pool of config.pools) {
      try {
        console.log(`[observe] ${pool.name} ${assetKey(pool.xrpl.asset0)} / ${assetKey(pool.xrpl.asset1)}`);
        await processPool(resolvedConfigPath, pool, oracle, state, wallet, config.defaults);
        saveState(statePath, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendErrorState(state, pool.name, message);
        saveState(statePath, state);
        await sendAlert(config, `XRPL LP oracle pool ${pool.name} failed: ${message}`);
      }
    }

    if (runOnce) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, config.defaults.pollIntervalMs));
  } while (true);
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
