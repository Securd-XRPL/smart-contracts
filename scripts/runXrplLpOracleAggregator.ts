import fs from "fs";
import path from "path";
import { ethers } from "ethers";

import {
  aggregateLpOracleReports,
  lpOracleDomain,
  LpOracleSignedReport,
  recoverLpOracleReportSigner
} from "./xrplLpOracleQuorum";

const REPORTER_ABI = [
  "function submitPrice(address asset, uint256 roundId, uint256 priceMantissa) external",
  "function finalizeRound(address asset, uint256 roundId) external"
];

interface SignedReportFileEntry {
  report: {
    poolId: string;
    collateralAsset: string;
    roundId: string;
    nonce: string;
    observedAt: string;
    validUntil: string;
    priceMantissa: string;
  };
  signature: string;
}

interface AggregatorConfig {
  chainId: bigint;
  reporterContract: string;
  minSigners: number;
  maxSpreadBps: number;
  submissionsFile: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function loadAggregatorConfig(): AggregatorConfig {
  return {
    chainId: BigInt(requiredEnv("LP_ORACLE_CHAIN_ID")),
    reporterContract: requiredEnv("LP_ORACLE_REPORTER_CONTRACT"),
    minSigners: Number(requiredEnv("LP_ORACLE_MIN_SIGNERS")),
    maxSpreadBps: Number(requiredEnv("LP_ORACLE_MAX_SPREAD_BPS")),
    submissionsFile: requiredEnv("LP_ORACLE_SIGNED_REPORTS_FILE")
  };
}

function parseReport(entry: SignedReportFileEntry): LpOracleSignedReport {
  return {
    poolId: entry.report.poolId,
    collateralAsset: entry.report.collateralAsset,
    roundId: BigInt(entry.report.roundId),
    nonce: BigInt(entry.report.nonce),
    observedAt: BigInt(entry.report.observedAt),
    validUntil: BigInt(entry.report.validUntil),
    priceMantissa: BigInt(entry.report.priceMantissa)
  };
}

async function main() {
  const config = loadAggregatorConfig();
  const provider = new ethers.JsonRpcProvider(requiredEnv("XRPL_EVM_RPC_URL"));
  const wallet = new ethers.Wallet(requiredEnv("LP_ORACLE_AGGREGATOR_PRIVATE_KEY"), provider);
  const reporter = new ethers.Contract(config.reporterContract, REPORTER_ABI, wallet);
  const domain = lpOracleDomain(config.chainId, config.reporterContract);

  const submissionsPath = path.resolve(config.submissionsFile);
  const raw = JSON.parse(fs.readFileSync(submissionsPath, "utf8")) as SignedReportFileEntry[];

  const recovered = await Promise.all(
    raw.map(async (entry) => {
      const report = parseReport(entry);
      const signer = await recoverLpOracleReportSigner(domain, report, entry.signature);
      return { ...report, signer };
    })
  );

  const medianPrice = aggregateLpOracleReports(recovered, {
    minSigners: config.minSigners,
    maxSpreadBps: config.maxSpreadBps
  });

  const first = recovered[0];
  console.log(`Publishing round ${first.roundId.toString()} for ${first.collateralAsset} with median ${medianPrice.toString()}`);

  for (const report of recovered) {
    const tx = await reporter.submitPrice(report.collateralAsset, report.roundId, report.priceMantissa);
    await tx.wait();
  }

  const finalizeTx = await reporter.finalizeRound(first.collateralAsset, first.roundId);
  const receipt = await finalizeTx.wait();
  console.log(`Finalized round tx: ${receipt?.hash ?? finalizeTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
