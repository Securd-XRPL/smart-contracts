// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("JumpRateModelV2", function () {
  it("calculates utilization, borrow rate, and supply rate across the kink", async function () {
    const [owner] = await ethers.getSigners();
    const blocksPerYear = 9_014_400n; // calibrated for XRPL EVM ~3.5 s/block
    const kink = ethers.parseEther("0.8");
    const baseRatePerYear = ethers.parseEther("0.02");
    const multiplierPerYear = ethers.parseEther("0.1");
    const jumpMultiplierPerYear = ethers.parseEther("1");

    const model = await (
      await ethers.getContractFactory("JumpRateModelV2")
    ).deploy(baseRatePerYear, multiplierPerYear, jumpMultiplierPerYear, kink, owner.address);

    expect(await model.utilizationRate(1000, 0, 0)).to.equal(0);
    expect(await model.baseRatePerBlock()).to.equal(baseRatePerYear / blocksPerYear);
    expect(await model.jumpMultiplierPerBlock()).to.equal(jumpMultiplierPerYear / blocksPerYear);

    const cash = 800n;
    const borrows = 200n;
    const reserves = 0n;
    const util = (borrows * 10n ** 18n) / (cash + borrows - reserves);
    expect(await model.utilizationRate(cash, borrows, reserves)).to.equal(util);

    const multiplierPerBlock = await model.multiplierPerBlock();
    const baseRatePerBlock = await model.baseRatePerBlock();
    const belowKinkBorrowRate = ((util * multiplierPerBlock) / 10n ** 18n) + baseRatePerBlock;
    expect(await model.getBorrowRate(cash, borrows, reserves)).to.equal(belowKinkBorrowRate);

    const reserveFactor = ethers.parseEther("0.1");
    const rateToPool = (belowKinkBorrowRate * (10n ** 18n - reserveFactor)) / 10n ** 18n;
    const expectedSupplyRate = (util * rateToPool) / 10n ** 18n;
    expect(await model.getSupplyRate(cash, borrows, reserves, reserveFactor)).to.equal(expectedSupplyRate);

    const highCash = 100n;
    const highBorrows = 900n;
    const highUtil = (highBorrows * 10n ** 18n) / (highCash + highBorrows);
    const normalRate = ((kink * multiplierPerBlock) / 10n ** 18n) + baseRatePerBlock;
    const excessUtil = highUtil - kink;
    const expectedJumpRate = ((excessUtil * (await model.jumpMultiplierPerBlock())) / 10n ** 18n) + normalRate;
    expect(await model.getBorrowRate(highCash, highBorrows, 0)).to.equal(expectedJumpRate);
  });

  it("allows only the owner to update interest parameters", async function () {
    const [owner, other] = await ethers.getSigners();
    const model = await (
      await ethers.getContractFactory("JumpRateModelV2")
    ).deploy(0, 0, 0, ethers.parseEther("0.8"), owner.address);

    await expect(
      model.connect(other).updateJumpRateModel(
        ethers.parseEther("0.03"),
        ethers.parseEther("0.12"),
        ethers.parseEther("1.2"),
        ethers.parseEther("0.85")
      )
    ).to.be.revertedWith("only the owner may call this function.");

    await expect(
      model.updateJumpRateModel(
        ethers.parseEther("0.03"),
        ethers.parseEther("0.12"),
        ethers.parseEther("1.2"),
        ethers.parseEther("0.85")
      )
    ).to.emit(model, "NewInterestParams");

    expect(await model.kink()).to.equal(ethers.parseEther("0.85"));
  });
});
