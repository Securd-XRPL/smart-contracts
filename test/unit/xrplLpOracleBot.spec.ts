import { expect } from "chai";

import {
  absDiffBps,
  computePublishedPriceMantissa,
  exceedsReserveJumpBps,
  parseDecimalToE18,
  shouldPublish
} from "../../scripts/runXrplLpOracleBot";
import { XrplLpOraclePoolConfig } from "../../scripts/xrplLpOracleConfig";

describe("XRPL LP oracle bot helpers", function () {
  const pool: XrplLpOraclePoolConfig = {
    name: "XRPL-USDC-XRP",
    xrpl: {
      asset0: { currency: "XRP" },
      asset1: { currency: "USD", issuer: "rIssuerAddress" }
    },
    evm: {
      collateralAsset: "0x0000000000000000000000000000000000000001",
      underlyingDecimals: 18,
      token0: "0x0000000000000000000000000000000000000010",
      token1: "0x0000000000000000000000000000000000000020"
    },
    risk: {
      haircutBps: 800,
      minTvlUsd: "500000",
      maxTokenWeightBps: 8500
    }
  };

  it("computes price mantissa conservatively with haircut", function () {
    const reserve0E18 = 100n * 10n ** 18n;
    const reserve1E18 = 200n * 10n ** 18n;
    const price0E18 = 2n * 10n ** 18n;
    const price1E18 = 1n * 10n ** 18n;
    const lpSupplyE18 = 50n * 10n ** 18n;

    const result = computePublishedPriceMantissa(
      reserve0E18,
      reserve1E18,
      price0E18,
      price1E18,
      lpSupplyE18,
      800,
      18
    );

    expect(result).to.equal(7360000000000000000n);
  });

  it("rescales mantissa for non-18-decimal collateral assets", function () {
    const result = computePublishedPriceMantissa(
      100n * 10n ** 18n,
      0n,
      1n * 10n ** 18n,
      0n,
      10n * 10n ** 18n,
      0,
      6
    );

    expect(result).to.equal(10n * 10n ** 30n);
  });

  it("computes deviation bps and reserve jump checks", function () {
    expect(absDiffBps(110n, 100n)).to.equal(1000n);
    expect(exceedsReserveJumpBps(120n, 100n, 1500)).to.equal(true);
    expect(exceedsReserveJumpBps(110n, 100n, 1500)).to.equal(false);
  });

  it("publishes on first observation, by time, or by deviation", function () {
    const nextMantissa = 2n * 10n ** 18n;

    expect(
      shouldPublish(pool, { pools: {} }, nextMantissa, 1000, 120, 100)
    ).to.equal(true);

    const state = {
      pools: {
        [pool.name]: {
          lastPublishedMantissa: (1n * 10n ** 18n).toString(),
          lastPublishedAt: 950
        }
      }
    };

    expect(shouldPublish(pool, state, nextMantissa, 1000, 120, 100)).to.equal(true);
    expect(shouldPublish(pool, state, 1005000000000000000n, 1000, 120, 100)).to.equal(false);
    expect(shouldPublish(pool, state, 1005000000000000000n, 1100, 120, 100)).to.equal(true);
  });

  it("parses decimal strings into 1e18 precision", function () {
    expect(parseDecimalToE18("1")).to.equal(10n ** 18n);
    expect(parseDecimalToE18("1.25")).to.equal(1250000000000000000n);
  });
});
