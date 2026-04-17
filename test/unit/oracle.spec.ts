// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("SecurdPriceOracle", function () {
  it("rejects missing oracle configuration and unauthorized fallback posters", async function () {
    const [owner, outsider] = await ethers.getSigners();
    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const asset = ethers.Wallet.createRandom().address;

    await expect(oracle.setOracleType(asset, 1)).to.be.revertedWithCustomError(oracle, "MissingChainlinkConfig");
    await expect(oracle.setOracleType(asset, 2)).to.be.revertedWithCustomError(oracle, "MissingBandConfig");
    await expect(oracle.setOracleType(asset, 3)).to.be.revertedWithCustomError(oracle, "MissingFallbackConfig");

    await oracle.setFallbackConfig(asset, 3600);
    await expect(oracle.connect(outsider).postFallbackPrice(asset, 1n)).to.be.revertedWithCustomError(
      oracle,
      "NotAssetOracle"
    );
  });

  it("reads a Chainlink-configured price", async function () {
    const [owner] = await ethers.getSigners();
    const Band = await ethers.getContractFactory("MockBandStdReference");
    const band = await Band.deploy();
    const Oracle = await ethers.getContractFactory("SecurdPriceOracle");
    const oracle = await Oracle.deploy(owner.address, band.target);
    const Agg = await ethers.getContractFactory("MockChainlinkAggregator");
    const agg = await Agg.deploy(8);
    const asset = ethers.Wallet.createRandom().address;
    const cToken = await (await ethers.getContractFactory("MockCTokenWithUnderlying")).deploy(asset);

    const latest = await ethers.provider.getBlock("latest");
    await agg.setRoundData(123456789n, BigInt(latest!.timestamp), 1);
    await oracle.setChainlinkConfig(asset, agg.target, 3600);
    await oracle.setOracleType(asset, 1);

    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(1234567890000000000n);
  });

  it("returns zero for stale or invalid Chainlink data and rescales decimals above 18", async function () {
    const [owner] = await ethers.getSigners();
    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const asset = ethers.Wallet.createRandom().address;
    const cToken = await (await ethers.getContractFactory("MockCTokenWithUnderlying")).deploy(asset);
    const agg = await (await ethers.getContractFactory("MockChainlinkAggregator")).deploy(20);
    const latest = await ethers.provider.getBlock("latest");

    await agg.setRoundData(-1n, BigInt(latest!.timestamp), 1);
    await oracle.setChainlinkConfig(asset, agg.target, 3600);
    await oracle.setOracleType(asset, 1);
    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(0);

    await agg.setRoundData(123456789012345678901n, BigInt(latest!.timestamp), 1);
    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(1234567890123456789n);

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);
    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(0);
  });

  it("supports per-asset fallback posting and staleness", async function () {
    const [owner, bot] = await ethers.getSigners();
    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const asset = ethers.Wallet.createRandom().address;
    const cToken = await (await ethers.getContractFactory("MockCTokenWithUnderlying")).deploy(asset);

    await oracle.setFallbackConfig(asset, 1000);
    await oracle.setAssetOracle(asset, bot.address, true);
    await oracle.setOracleType(asset, 3);
    await oracle.connect(bot).postFallbackPrice(asset, 2n * 10n ** 18n);

    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(2n * 10n ** 18n);

    await ethers.provider.send("evm_increaseTime", [1001]);
    await ethers.provider.send("evm_mine", []);
    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(0);
  });

  it("reads Band prices when configured", async function () {
    const [owner] = await ethers.getSigners();
    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const asset = ethers.Wallet.createRandom().address;
    const cToken = await (await ethers.getContractFactory("MockCTokenWithUnderlying")).deploy(asset);
    const latest = await ethers.provider.getBlock("latest");

    await band.setReferenceData(5n * 10n ** 18n, BigInt(latest!.timestamp), BigInt(latest!.timestamp));
    await oracle.setBandConfig(asset, "XRP", "USD", 3600);
    await oracle.setOracleType(asset, 2);

    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(5n * 10n ** 18n);
  });

  it("supports configured cToken-underlying overrides and previewing all price sources", async function () {
    const [owner, bot] = await ethers.getSigners();
    const band = await (await ethers.getContractFactory("MockBandStdReference")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, band.target);
    const configuredAsset = ethers.Wallet.createRandom().address;
    const cToken = await (await ethers.getContractFactory("MockCTokenWithUnderlying")).deploy(
      ethers.Wallet.createRandom().address
    );
    const agg = await (await ethers.getContractFactory("MockChainlinkAggregator")).deploy(8);
    const latest = await ethers.provider.getBlock("latest");

    await oracle.setCTokenUnderlying(cToken.target, configuredAsset);
    await agg.setRoundData(2_50000000n, BigInt(latest!.timestamp), 1);
    await oracle.setChainlinkConfig(configuredAsset, agg.target, 3600);
    await oracle.setBandConfig(configuredAsset, "XRP", "USD", 3600);
    await band.setReferenceData(3n * 10n ** 18n, BigInt(latest!.timestamp), BigInt(latest!.timestamp));
    await oracle.setFallbackConfig(configuredAsset, 3600);
    await oracle.setAssetOracle(configuredAsset, bot.address, true);
    await oracle.connect(bot).postFallbackPrice(configuredAsset, 4n * 10n ** 18n);
    await oracle.setOracleType(configuredAsset, 2);

    const preview = await oracle.previewPrices(configuredAsset);
    expect(preview.chainlinkPriceMantissa).to.equal(25n * 10n ** 17n);
    expect(preview.bandPriceMantissa).to.equal(3n * 10n ** 18n);
    expect(preview.fallbackPriceMantissa).to.equal(4n * 10n ** 18n);
    expect(preview.selectedPriceMantissa).to.equal(3n * 10n ** 18n);
    expect(await oracle.getUnderlyingPrice(cToken.target)).to.equal(3n * 10n ** 18n);
  });
});
