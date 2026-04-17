// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("CErc20 / CToken market behavior", function () {
  async function deployFixture() {
    const [owner, supplier, borrower, liquidator, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const collateralAsset = await Token.deploy("Collateral Token", "COL", 18);
    const debtAsset = await Token.deploy("Debt Token", "USD", 18);
    const strayToken = await Token.deploy("Stray Token", "STR", 18);

    const Oracle = await ethers.getContractFactory("SecurdPriceOracle");
    const oracle = await Oracle.deploy(owner.address, ethers.ZeroAddress);

    const JumpRateModel = await ethers.getContractFactory("JumpRateModelV2");
    const interestRateModel = await JumpRateModel.deploy(0, 0, 0, ethers.parseEther("0.8"), owner.address);
    const newerInterestRateModel = await JumpRateModel.deploy(
      ethers.parseEther("0.01"),
      ethers.parseEther("0.1"),
      ethers.parseEther("1"),
      ethers.parseEther("0.85"),
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
    await strayToken.mint(cDebt.target, ethers.parseEther("10"));

    return {
      owner,
      supplier,
      borrower,
      liquidator,
      other,
      collateralAsset,
      debtAsset,
      strayToken,
      oracle,
      comptroller,
      cCollateral,
      cDebt,
      interestRateModel,
      newerInterestRateModel
    };
  }

  it("supports transfer, transferFrom, and blocks self-transfer", async function () {
    const { borrower, other, collateralAsset, cCollateral } = await deployFixture();

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));

    await expect(cCollateral.connect(borrower).transfer(other.address, ethers.parseEther("10"))).to.emit(
      cCollateral,
      "Transfer"
    );
    expect(await cCollateral.balanceOf(other.address)).to.equal(ethers.parseEther("10"));

    await cCollateral.connect(borrower).approve(other.address, ethers.parseEther("5"));
    await expect(cCollateral.connect(other).transferFrom(borrower.address, other.address, ethers.parseEther("5"))).to.emit(
      cCollateral,
      "Transfer"
    );
    expect(await cCollateral.allowance(borrower.address, other.address)).to.equal(0);

    await expect(cCollateral.connect(borrower).transfer(borrower.address, ethers.parseEther("1"))).to.be.reverted;
  });

  it("supports repayBorrowBehalf and max repay paths", async function () {
    const { supplier, borrower, other, collateralAsset, debtAsset, comptroller, cCollateral, cDebt } = await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("50"));

    await debtAsset.connect(other).mint(other.address, ethers.parseEther("50"));
    await debtAsset.connect(other).approve(cDebt.target, ethers.parseEther("50"));
    await expect(cDebt.connect(other).repayBorrowBehalf(borrower.address, ethers.parseEther("20"))).to.emit(
      cDebt,
      "RepayBorrow"
    );
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(ethers.parseEther("30"));

    await debtAsset.connect(other).approve(cDebt.target, ethers.parseEther("30"));
    await cDebt.connect(other).repayBorrowBehalf(borrower.address, ethers.MaxUint256);
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(0);
  });

  it("supports reserve management, interest model changes, and sweeping non-underlying tokens", async function () {
    const { owner, supplier, debtAsset, strayToken, cDebt, newerInterestRateModel } = await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await debtAsset.connect(owner).mint(owner.address, ethers.parseEther("100"));
    await debtAsset.connect(owner).approve(cDebt.target, ethers.parseEther("100"));

    await expect(cDebt.connect(owner)._setReserveFactor(ethers.parseEther("0.1"))).to.emit(cDebt, "NewReserveFactor");
    expect(await cDebt.reserveFactorMantissa()).to.equal(ethers.parseEther("0.1"));

    await expect(cDebt.connect(owner)._addReserves(ethers.parseEther("20"))).to.emit(cDebt, "ReservesAdded");
    expect(await cDebt.totalReserves()).to.equal(ethers.parseEther("20"));

    await expect(cDebt.connect(owner)._reduceReserves(ethers.parseEther("5"))).to.emit(cDebt, "ReservesReduced");
    expect(await cDebt.totalReserves()).to.equal(ethers.parseEther("15"));

    await expect(cDebt.connect(owner)._setInterestRateModel(newerInterestRateModel.target)).to.emit(
      cDebt,
      "NewMarketInterestRateModel"
    );
    expect(await cDebt.interestRateModel()).to.equal(newerInterestRateModel.target);

    const ownerStrayBefore = await strayToken.balanceOf(owner.address);
    await cDebt.connect(owner).sweepToken(strayToken.target);
    expect(await strayToken.balanceOf(owner.address)).to.equal(ownerStrayBefore + ethers.parseEther("10"));

    await expect(cDebt.connect(owner).sweepToken(debtAsset.target)).to.be.revertedWith(
      "CErc20::sweepToken: can not sweep underlying token"
    );
  });

  it("enforces transfer restrictions from comptroller liquidity and global pause", async function () {
    const { owner, supplier, borrower, other, collateralAsset, debtAsset, comptroller, cCollateral, cDebt } =
      await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("50"));

    await expect(cCollateral.connect(borrower).transfer(other.address, ethers.parseEther("80"))).to.be.reverted;

    await comptroller._setPauseGuardian(owner.address);
    await comptroller._setTransferPaused(true);
    await expect(cCollateral.connect(borrower).transfer(other.address, ethers.parseEther("1"))).to.be.revertedWith(
      "transfer is paused"
    );
  });

  it("enforces liquidation edge cases at the market layer", async function () {
    const { supplier, borrower, liquidator, collateralAsset, debtAsset, oracle, comptroller, cCollateral, cDebt } =
      await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("60"));

    await debtAsset.connect(liquidator).approve(cDebt.target, ethers.parseEther("60"));

    await expect(cDebt.connect(liquidator).liquidateBorrow(borrower.address, 0, cCollateral.target)).to.be.reverted;

    await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther("0.5"));

    await expect(
      cDebt.connect(borrower).liquidateBorrow(borrower.address, ethers.parseEther("1"), cCollateral.target)
    ).to.be.reverted;

    await expect(
      cDebt.connect(liquidator).liquidateBorrow(borrower.address, ethers.MaxUint256, cCollateral.target)
    ).to.be.reverted;

    await expect(
      cDebt.connect(liquidator).liquidateBorrow(borrower.address, ethers.parseEther("40"), cCollateral.target)
    ).to.be.reverted;

    await expect(
      cDebt.connect(liquidator).liquidateBorrow(borrower.address, ethers.parseEther("30"), cCollateral.target)
    ).to.emit(cDebt, "LiquidateBorrow");
  });
});
