// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("SecurdLiquidationKeeper", function () {
  async function deployFixture() {
    const [owner, keeper, borrower, recipient, outsider] = await ethers.getSigners();
    const asset = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    const borrowedMarket = await (await ethers.getContractFactory("MockCErc20Market")).deploy(asset.target);
    const collateralMarket = await (await ethers.getContractFactory("MockCErc20Market")).deploy(asset.target);
    const wrapper = await (await ethers.getContractFactory("SecurdLiquidationKeeper")).deploy(owner.address);

    await asset.mint(owner.address, 1_000_000n);
    await asset.connect(owner).approve(wrapper.target, 1_000_000n);

    return { owner, keeper, borrower, recipient, outsider, asset, borrowedMarket, collateralMarket, wrapper };
  }

  it("funds treasury, enforces keeper and limit checks, and executes liquidation", async function () {
    const { owner, keeper, borrower, asset, borrowedMarket, collateralMarket, wrapper } = await deployFixture();

    await wrapper.setKeeper(keeper.address, true);
    await wrapper.setAssetLimit(asset.target, 100_000n);
    await wrapper.setMarketLimit(borrowedMarket.target, 100_000n);
    await wrapper.fund(asset.target, 200_000n);

    expect(await asset.balanceOf(wrapper.target)).to.equal(200_000n);

    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 10_000n, collateralMarket.target)
    )
      .to.emit(wrapper, "LiquidationExecuted")
      .withArgs(keeper.address, borrowedMarket.target, borrower.address, collateralMarket.target, asset.target, 10_000n);
  });

  it("reverts when limits are not configured or market returns an error", async function () {
    const { owner, keeper, borrower, asset, borrowedMarket, collateralMarket, wrapper } = await deployFixture();
    await wrapper.setKeeper(keeper.address, true);
    await wrapper.fund(asset.target, 100_000n);

    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 1n, collateralMarket.target)
    ).to.be.reverted;

    await wrapper.setAssetLimit(asset.target, 100_000n);
    await wrapper.setMarketLimit(borrowedMarket.target, 100_000n);
    await borrowedMarket.setResults(0, 0, 0, 0, 9);

    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 1_000n, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "LiquidationCallFailed");
  });

  it("enforces keeper auth, limit caps, pause controls, and sweep operations", async function () {
    const { keeper, borrower, recipient, outsider, asset, borrowedMarket, collateralMarket, wrapper } = await deployFixture();
    await wrapper.setKeeper(keeper.address, true);
    await wrapper.setAssetLimit(asset.target, 50_000n);
    await wrapper.setMarketLimit(borrowedMarket.target, 40_000n);
    await wrapper.fund(asset.target, 100_000n);

    await expect(
      wrapper.connect(outsider).executeLiquidation(borrowedMarket.target, borrower.address, 1_000n, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "NotKeeper");

    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 60_000n, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "AssetLimitExceeded");

    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 45_000n, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "MarketLimitExceeded");

    await wrapper.pause();
    await expect(wrapper.fund(asset.target, 1n)).to.be.revertedWith("Pausable: paused");
    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 1_000n, collateralMarket.target)
    ).to.be.revertedWith("Pausable: paused");
    await wrapper.unpause();

    await expect(wrapper.sweepAsset(asset.target, recipient.address, 10_000n))
      .to.emit(wrapper, "AssetSwept")
      .withArgs(asset.target, recipient.address, 10_000n);
    expect(await asset.balanceOf(recipient.address)).to.equal(10_000n);
  });

  it("allows the owner to liquidate directly and manages keeper updates", async function () {
    const { owner, keeper, borrower, asset, borrowedMarket, collateralMarket, wrapper } = await deployFixture();

    await expect(wrapper.setKeeper(keeper.address, true))
      .to.emit(wrapper, "KeeperSet")
      .withArgs(keeper.address, true);
    await expect(wrapper.setKeeper(keeper.address, false))
      .to.emit(wrapper, "KeeperSet")
      .withArgs(keeper.address, false);

    await wrapper.setAssetLimit(asset.target, 100_000n);
    await wrapper.setMarketLimit(borrowedMarket.target, 100_000n);
    await wrapper.fund(asset.target, 100_000n);

    await expect(
      wrapper.executeLiquidation(borrowedMarket.target, borrower.address, 5_000n, collateralMarket.target)
    )
      .to.emit(wrapper, "LiquidationExecuted")
      .withArgs(owner.address, borrowedMarket.target, borrower.address, collateralMarket.target, asset.target, 5_000n);
  });

  it("rejects invalid configuration and invalid liquidation inputs", async function () {
    const { owner, keeper, borrower, recipient, asset, borrowedMarket, collateralMarket, wrapper } = await deployFixture();

    await expect(wrapper.setKeeper(ethers.ZeroAddress, true)).to.be.revertedWith("keeper=0");
    await expect(wrapper.setAssetLimit(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(wrapper, "InvalidAsset");
    await expect(wrapper.setMarketLimit(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(wrapper, "InvalidMarket");
    await expect(wrapper.fund(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(wrapper, "InvalidAsset");
    await expect(wrapper.fund(asset.target, 0)).to.be.revertedWithCustomError(wrapper, "InvalidRepayAmount");

    await wrapper.setKeeper(keeper.address, true);
    await wrapper.setAssetLimit(asset.target, 100_000n);
    await wrapper.setMarketLimit(borrowedMarket.target, 100_000n);
    await wrapper.fund(asset.target, 100_000n);

    await expect(
      wrapper.connect(keeper).executeLiquidation(ethers.ZeroAddress, borrower.address, 1n, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "InvalidMarket");
    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 1n, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(wrapper, "InvalidMarket");
    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, ethers.ZeroAddress, 1n, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "InvalidBorrower");
    await expect(
      wrapper.connect(keeper).executeLiquidation(borrowedMarket.target, borrower.address, 0, collateralMarket.target)
    ).to.be.revertedWithCustomError(wrapper, "InvalidRepayAmount");

    await expect(wrapper.sweepAsset(ethers.ZeroAddress, recipient.address, 1n)).to.be.revertedWithCustomError(
      wrapper,
      "InvalidAsset"
    );
    await expect(wrapper.sweepAsset(asset.target, ethers.ZeroAddress, 1n)).to.be.revertedWith("to=0");
  });
});
