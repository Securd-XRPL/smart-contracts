import { expect } from "chai";
import { ethers } from "hardhat";

describe("SecurdMedianOracleReporter", function () {
  it("aggregates reporter submissions and forwards the median price to the fallback oracle", async function () {
    const [owner, reporter1, reporter2, reporter3] = await ethers.getSigners();
    const asset = ethers.Wallet.createRandom().address;

    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const reporter = await (await ethers.getContractFactory("SecurdMedianOracleReporter")).deploy(
      owner.address,
      oracle.target
    ) as any;
    const cToken = await (await ethers.getContractFactory("MockCTokenWithUnderlying")).deploy(asset);

    await oracle.setFallbackConfig(asset, 3600);
    await oracle.setOracleType(asset, 3);
    await oracle.setAssetOracle(asset, reporter.target, true);

    await reporter.setAssetConfig(asset, 100, 3);
    await reporter.setReporter(asset, reporter1.address, true);
    await reporter.setReporter(asset, reporter2.address, true);
    await reporter.setReporter(asset, reporter3.address, true);

    await reporter.connect(reporter1).submitPrice(asset, 1, 2n * 10n ** 18n);
    await reporter.connect(reporter2).submitPrice(asset, 1, 4n * 10n ** 18n);
    await reporter.connect(reporter3).submitPrice(asset, 1, 3n * 10n ** 18n);

    await ethers.provider.send("evm_increaseTime", [101]);
    await ethers.provider.send("evm_mine", []);

    await expect(reporter.finalizeRound(asset, 1))
      .to.emit(reporter, "RoundPosted")
      .withArgs(asset, 1, 3n * 10n ** 18n, 3);

    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(3n * 10n ** 18n);
  });

  it("enforces reporter authorization, duplicate protection, and pause controls", async function () {
    const [owner, reporter1, outsider] = await ethers.getSigners();
    const asset = ethers.Wallet.createRandom().address;

    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const reporter = await (await ethers.getContractFactory("SecurdMedianOracleReporter")).deploy(
      owner.address,
      oracle.target
    ) as any;

    await reporter.setAssetConfig(asset, 100, 2);
    await reporter.setReporter(asset, reporter1.address, true);

    await expect(reporter.connect(outsider).submitPrice(asset, 1, 1n)).to.be.revertedWithCustomError(
      reporter,
      "ReporterNotAuthorized"
    );

    await reporter.connect(reporter1).submitPrice(asset, 1, 1n);
    await expect(reporter.connect(reporter1).submitPrice(asset, 1, 2n)).to.be.revertedWithCustomError(
      reporter,
      "DuplicateSubmission"
    );

    await reporter.pause();
    await expect(reporter.connect(reporter1).submitPrice(asset, 2, 1n)).to.be.revertedWith("Pausable: paused");
  });
});
