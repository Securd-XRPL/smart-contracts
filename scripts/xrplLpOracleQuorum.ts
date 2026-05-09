import { ethers } from "ethers";

export interface LpOracleSignedReport {
  poolId: string;
  collateralAsset: string;
  roundId: bigint;
  nonce: bigint;
  observedAt: bigint;
  validUntil: bigint;
  priceMantissa: bigint;
}

export interface LpOracleRecoveredReport extends LpOracleSignedReport {
  signer: string;
}

export interface LpOracleQuorumConfig {
  minSigners: number;
  maxSpreadBps: number;
}

export const LP_ORACLE_REPORT_TYPES: Record<string, ethers.TypedDataField[]> = {
  LpOracleReport: [
    { name: "poolId", type: "bytes32" },
    { name: "collateralAsset", type: "address" },
    { name: "roundId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "observedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "priceMantissa", type: "uint256" }
  ]
} as const;

export function lpOracleDomain(chainId: bigint, verifyingContract: string) {
  return {
    name: "Securd LP Oracle",
    version: "1",
    chainId,
    verifyingContract
  };
}

export function poolIdFromName(name: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

export async function signLpOracleReport(
  wallet: { signTypedData: (domain: ReturnType<typeof lpOracleDomain>, types: Record<string, ethers.TypedDataField[]>, value: LpOracleSignedReport) => Promise<string> },
  domain: ReturnType<typeof lpOracleDomain>,
  report: LpOracleSignedReport
): Promise<string> {
  return wallet.signTypedData(domain, LP_ORACLE_REPORT_TYPES, report);
}

export async function recoverLpOracleReportSigner(
  domain: ReturnType<typeof lpOracleDomain>,
  report: LpOracleSignedReport,
  signature: string
): Promise<string> {
  return ethers.verifyTypedData(domain, LP_ORACLE_REPORT_TYPES, report, signature);
}

export function absDiffBps(nextValue: bigint, previousValue: bigint): bigint {
  if (previousValue === 0n) {
    return 10_000n;
  }
  const diff = nextValue > previousValue ? nextValue - previousValue : previousValue - nextValue;
  return (diff * 10_000n) / previousValue;
}

export function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2n;
}

export function aggregateLpOracleReports(
  reports: LpOracleRecoveredReport[],
  config: LpOracleQuorumConfig,
  allowedSigners?: Set<string>
): bigint {
  if (reports.length < config.minSigners) {
    throw new Error(`Insufficient reports: have ${reports.length}, need ${config.minSigners}`);
  }

  const first = reports[0];
  for (const report of reports) {
    if (
      report.poolId !== first.poolId
      || report.collateralAsset.toLowerCase() !== first.collateralAsset.toLowerCase()
      || report.roundId !== first.roundId
      || report.nonce !== first.nonce
    ) {
      throw new Error("Report set mismatch");
    }
    if (report.validUntil < report.observedAt) {
      throw new Error("Invalid report expiry");
    }
    if (report.validUntil < BigInt(Math.floor(Date.now() / 1000))) {
      throw new Error("Report expired");
    }
    if (allowedSigners && !allowedSigners.has(report.signer.toLowerCase())) {
      throw new Error(`Signer not in authorized set: ${report.signer}`);
    }
  }

  const uniqueSigners = new Set(reports.map((report) => report.signer.toLowerCase()));
  if (uniqueSigners.size < config.minSigners) {
    throw new Error("Insufficient unique signers");
  }

  const prices = reports.map((report) => report.priceMantissa);
  const medianPrice = median(prices);

  for (const price of prices) {
    if (absDiffBps(price, medianPrice) > BigInt(config.maxSpreadBps)) {
      throw new Error("Report spread exceeds threshold");
    }
  }

  return medianPrice;
}
