// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Securd core lending integration", function () {
  async function deployCoreFixture() {
    const [owner, supplier, borrower, liquidator] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const collateralAsset = await Token.deploy("Collateral Token", "COL", 18);
    const debtAsset = await Token.deploy("Debt Token", "USD", 18);

    const Oracle = await ethers.getContractFactory("SecurdPriceOracle");
    const oracle = await Oracle.deploy(owner.address, ethers.ZeroAddress);

    const JumpRateModel = await ethers.getContractFactory("JumpRateModelV2");
    const interestRateModel = await JumpRateModel.deploy(
      0,
      0,
      0,
      ethers.parseEther("0.8"),
      owner.address
    );

    const ComptrollerImpl = await ethers.getContractFactory("Comptroller");
    const comptrollerImpl = await ComptrollerImpl.deploy();
    const Unitroller = await ethers.getContractFactory("Unitroller");
    const unitroller = await Unitroller.deploy();

    await unitroller._setPendingImplementation(comptrollerImpl.target);
    await comptrollerImpl._become(unitroller.target);
    const comptroller = await ethers.getContractAt("Comptroller", unitroller.target);

    await comptroller._setPriceOracle(oracle.target);
    await comptroller._setCloseFactor(ethers.parseEther("0.5"));
    await comptroller._setLiquidationIncentive(ethers.parseEther("1.08"));

    const Delegate = await ethers.getContractFactory("CErc20Delegate");
    const delegate = await Delegate.deploy();
    const Delegator = await ethers.getContractFactory("CErc20Delegator");

    const cCollateral = await Delegator.deploy(
      collateralAsset.target,
      unitroller.target,
      interestRateModel.target,
      ethers.parseEther("1"),
      "Securd Collateral",
      "sCOL",
      8,
      owner.address,
      delegate.target,
      "0x"
    );

    const cDebt = await Delegator.deploy(
      debtAsset.target,
      unitroller.target,
      interestRateModel.target,
      ethers.parseEther("1"),
      "Securd Debt",
      "sUSD",
      8,
      owner.address,
      delegate.target,
      "0x"
    );

    await comptroller._supportMarket(cCollateral.target);
    await comptroller._supportMarket(cDebt.target);

    for (const asset of [collateralAsset, debtAsset]) {
      await oracle.setFallbackConfig(asset.target, 86400);
      await oracle.setOracleType(asset.target, 3);
      await oracle.postFallbackPrice(asset.target, ethers.parseEther("1"));
    }

    await comptroller._setCollateralFactor(cCollateral.target, ethers.parseEther("0.75"));
    await comptroller._setCollateralFactor(cDebt.target, 0);

    await collateralAsset.mint(borrower.address, ethers.parseEther("100"));
    await debtAsset.mint(supplier.address, ethers.parseEther("500"));
    await debtAsset.mint(liquidator.address, ethers.parseEther("500"));

    return {
      owner,
      supplier,
      borrower,
      liquidator,
      collateralAsset,
      debtAsset,
      oracle,
      interestRateModel,
      comptroller,
      unitroller,
      cCollateral,
      cDebt
    };
  }

  it("sets up the proxied comptroller and lists markets", async function () {
    const { borrower, comptroller, cCollateral, cDebt } = await deployCoreFixture();

    expect(await comptroller.oracle()).to.not.equal(ethers.ZeroAddress);
    expect(await comptroller.closeFactorMantissa()).to.equal(ethers.parseEther("0.5"));
    expect(await comptroller.liquidationIncentiveMantissa()).to.equal(ethers.parseEther("1.08"));
    expect(await comptroller.checkMembership(borrower.address, cCollateral.target)).to.equal(false);
    expect(await comptroller.markets(cCollateral.target)).to.deep.equal([true, ethers.parseEther("0.75"), false]);
    expect(await comptroller.markets(cDebt.target)).to.deep.equal([true, 0n, false]);
  });

  it("supports supply, market entry, borrow, repay, redeem, and exit", async function () {
    const { supplier, borrower, collateralAsset, debtAsset, comptroller, cCollateral, cDebt } = await deployCoreFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await expect(cDebt.connect(supplier).mint(ethers.parseEther("500"))).to.emit(cDebt, "Mint");

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await expect(cCollateral.connect(borrower).mint(ethers.parseEther("100"))).to.emit(cCollateral, "Mint");

    expect(await comptroller.connect(borrower).enterMarkets.staticCall([cCollateral.target])).to.deep.equal([0n]);
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    expect(await comptroller.checkMembership(borrower.address, cCollateral.target)).to.equal(true);

    await expect(cDebt.connect(borrower).borrow(ethers.parseEther("50"))).to.emit(cDebt, "Borrow");
    expect(await debtAsset.balanceOf(borrower.address)).to.equal(ethers.parseEther("50"));
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(ethers.parseEther("50"));

    await debtAsset.connect(borrower).approve(cDebt.target, ethers.parseEther("20"));
    await expect(cDebt.connect(borrower).repayBorrow(ethers.parseEther("20"))).to.emit(cDebt, "RepayBorrow");
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(ethers.parseEther("30"));

    await debtAsset.connect(borrower).approve(cDebt.target, ethers.parseEther("30"));
    await cDebt.connect(borrower).repayBorrow(ethers.MaxUint256);
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(0);

    await expect(cCollateral.connect(borrower).redeemUnderlying(ethers.parseEther("10"))).to.emit(cCollateral, "Redeem");
    expect(await collateralAsset.balanceOf(borrower.address)).to.equal(ethers.parseEther("10"));

    expect(await comptroller.connect(borrower).exitMarket.staticCall(cCollateral.target)).to.equal(0);
    await comptroller.connect(borrower).exitMarket(cCollateral.target);
    expect(await comptroller.checkMembership(borrower.address, cCollateral.target)).to.equal(false);
  });

  it("allows liquidation after a collateral price drop", async function () {
    const { supplier, borrower, liquidator, collateralAsset, debtAsset, oracle, comptroller, cCollateral, cDebt } =
      await deployCoreFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);

    await cDebt.connect(borrower).borrow(ethers.parseEther("60"));
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(ethers.parseEther("60"));

    await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther("0.5"));

    const [, , shortfall] = await comptroller.getAccountLiquidity(borrower.address);
    expect(shortfall).to.be.gt(0);

    await debtAsset.connect(liquidator).approve(cDebt.target, ethers.parseEther("30"));
    await expect(
      cDebt.connect(liquidator).liquidateBorrow(borrower.address, ethers.parseEther("30"), cCollateral.target)
    ).to.emit(cDebt, "LiquidateBorrow");

    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(ethers.parseEther("30"));
    expect(await cCollateral.balanceOf(liquidator.address)).to.be.gt(0);
  });
});
