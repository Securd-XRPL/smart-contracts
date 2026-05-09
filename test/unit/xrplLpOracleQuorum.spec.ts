import { expect } from "chai";
import { ethers } from "ethers";

import {
  aggregateLpOracleReports,
  lpOracleDomain,
  poolIdFromName,
  recoverLpOracleReportSigner,
  signLpOracleReport
} from "../../scripts/xrplLpOracleQuorum";

describe("XRPL LP oracle quorum", function () {
  it("signs, recovers, and aggregates median reports", async function () {
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();
    const wallet3 = ethers.Wallet.createRandom();
    const domain = lpOracleDomain(1440002n, "0x0000000000000000000000000000000000000009");
    const baseReport = {
      poolId: poolIdFromName("XRPL-USDC-XRP"),
      collateralAsset: "0x0000000000000000000000000000000000000001",
      roundId: 1n,
      nonce: 1n,
      observedAt: BigInt(Math.floor(Date.now() / 1000)),
      validUntil: BigInt(Math.floor(Date.now() / 1000) + 300)
    };

    const reports = [
      { ...baseReport, priceMantissa: 2n * 10n ** 18n },
      { ...baseReport, priceMantissa: 3n * 10n ** 18n },
      { ...baseReport, priceMantissa: 4n * 10n ** 18n }
    ];

    const signatures = await Promise.all([
      signLpOracleReport(wallet1, domain, reports[0]),
      signLpOracleReport(wallet2, domain, reports[1]),
      signLpOracleReport(wallet3, domain, reports[2])
    ]);

    const recovered = await Promise.all(
      reports.map(async (report, index) => ({
        ...report,
        signer: await recoverLpOracleReportSigner(domain, report, signatures[index])
      }))
    );

    const medianPrice = aggregateLpOracleReports(recovered, { minSigners: 3, maxSpreadBps: 4000 });
    expect(medianPrice).to.equal(3n * 10n ** 18n);
    expect(recovered[0].signer).to.equal(wallet1.address);
  });

  it("rejects mismatched or too-wide report sets", async function () {
    const reports = [
      {
        poolId: poolIdFromName("XRPL-USDC-XRP"),
        collateralAsset: "0x0000000000000000000000000000000000000001",
        roundId: 1n,
        nonce: 1n,
        observedAt: BigInt(Math.floor(Date.now() / 1000)),
        validUntil: BigInt(Math.floor(Date.now() / 1000) + 300),
        priceMantissa: 1n * 10n ** 18n,
        signer: "0x0000000000000000000000000000000000000011"
      },
      {
        poolId: poolIdFromName("XRPL-USDC-XRP"),
        collateralAsset: "0x0000000000000000000000000000000000000001",
        roundId: 1n,
        nonce: 1n,
        observedAt: BigInt(Math.floor(Date.now() / 1000)),
        validUntil: BigInt(Math.floor(Date.now() / 1000) + 300),
        priceMantissa: 5n * 10n ** 18n,
        signer: "0x0000000000000000000000000000000000000012"
      }
    ];

    expect(() => aggregateLpOracleReports(reports, { minSigners: 2, maxSpreadBps: 1000 })).to.throw(
      "Report spread exceeds threshold"
    );
  });

  it("rejects signers not in the authorized set", async function () {
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const reports = [
      {
        poolId: poolIdFromName("XRPL-USDC-XRP"),
        collateralAsset: "0x0000000000000000000000000000000000000001",
        roundId: 1n,
        nonce: 1n,
        observedAt: now,
        validUntil: now + 300n,
        priceMantissa: 2n * 10n ** 18n,
        signer: wallet1.address
      },
      {
        poolId: poolIdFromName("XRPL-USDC-XRP"),
        collateralAsset: "0x0000000000000000000000000000000000000001",
        roundId: 1n,
        nonce: 1n,
        observedAt: now,
        validUntil: now + 300n,
        priceMantissa: 2n * 10n ** 18n,
        signer: wallet2.address
      }
    ];

    const allowedSigners = new Set([wallet1.address.toLowerCase()]);
    expect(() => aggregateLpOracleReports(reports, { minSigners: 2, maxSpreadBps: 4000 }, allowedSigners)).to.throw(
      `Signer not in authorized set: ${wallet2.address}`
    );

    const allAllowed = new Set([wallet1.address.toLowerCase(), wallet2.address.toLowerCase()]);
    expect(aggregateLpOracleReports(reports, { minSigners: 2, maxSpreadBps: 4000 }, allAllowed)).to.equal(2n * 10n ** 18n);
  });

  it("rejects expired reports", async function () {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const reports = [
      {
        poolId: poolIdFromName("XRPL-USDC-XRP"),
        collateralAsset: "0x0000000000000000000000000000000000000001",
        roundId: 1n,
        nonce: 1n,
        observedAt: now - 100n,
        validUntil: now - 1n,
        priceMantissa: 2n * 10n ** 18n,
        signer: "0x0000000000000000000000000000000000000011"
      },
      {
        poolId: poolIdFromName("XRPL-USDC-XRP"),
        collateralAsset: "0x0000000000000000000000000000000000000001",
        roundId: 1n,
        nonce: 1n,
        observedAt: now - 100n,
        validUntil: now - 1n,
        priceMantissa: 2n * 10n ** 18n,
        signer: "0x0000000000000000000000000000000000000012"
      }
    ];

    expect(() => aggregateLpOracleReports(reports, { minSigners: 2, maxSpreadBps: 1000 })).to.throw(
      "Report expired"
    );
  });
});
