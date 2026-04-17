import { expect } from "chai";
import { ethers } from "hardhat";

describe("Median oracle deployment integration", function () {
  it("authorizes the median reporter for fallback assets and configures reporters", async function () {
    const [owner, reporter1, reporter2] = await ethers.getSigners();
    const asset = ethers.Wallet.createRandom().address;

    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const medianReporter = await (await ethers.getContractFactory("SecurdMedianOracleReporter")).deploy(
      owner.address,
      oracle.target
    ) as any;

    await oracle.setFallbackConfig(asset, 3600);
    await oracle.setOracleType(asset, 3);
    await oracle.setAssetOracle(asset, medianReporter.target, true);

    await medianReporter.setAssetConfig(asset, 300, 2);
    await medianReporter.setReporter(asset, reporter1.address, true);
    await medianReporter.setReporter(asset, reporter2.address, true);

    expect(await oracle.isAssetOracle(asset, medianReporter.target)).to.equal(true);
    expect(await medianReporter.isReporterForAsset(asset, reporter1.address)).to.equal(true);
    expect(await medianReporter.isReporterForAsset(asset, reporter2.address)).to.equal(true);

    const config = await medianReporter.assetConfig(asset);
    expect(config.roundDuration).to.equal(300);
    expect(config.minSubmissions).to.equal(2);
  });
});
