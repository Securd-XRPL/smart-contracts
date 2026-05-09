// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Comptroller integration", function () {
  async function deployFixture() {
    const [owner, pauseGuardian, supplier, borrower, liquidator, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const collateralAsset = await Token.deploy("Collateral Token", "COL", 18);
    const debtAsset = await Token.deploy("Debt Token", "USD", 18);

    const Oracle = await ethers.getContractFactory("SecurdPriceOracle");
    const oracle = await Oracle.deploy(owner.address, ethers.ZeroAddress);

    const JumpRateModel = await ethers.getContractFactory("JumpRateModelV2");
    const interestRateModel = await JumpRateModel.deploy(0, 0, 0, ethers.parseEther("0.8"), owner.address);

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

    await oracle.setFallbackConfig(collateralAsset.target, 86400);
    await oracle.setOracleType(collateralAsset.target, 3);
    await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther("1"));

    await oracle.setFallbackConfig(debtAsset.target, 86400);
    await oracle.setOracleType(debtAsset.target, 3);
    await oracle.postFallbackPrice(debtAsset.target, ethers.parseEther("1"));

    await comptroller._setCollateralFactor(cCollateral.target, ethers.parseEther("0.75"));
    await comptroller._setCollateralFactor(cDebt.target, 0);

    await collateralAsset.mint(borrower.address, ethers.parseEther("100"));
    await debtAsset.mint(supplier.address, ethers.parseEther("500"));
    await debtAsset.mint(liquidator.address, ethers.parseEther("500"));

    return {
      owner,
      pauseGuardian,
      supplier,
      borrower,
      liquidator,
      other,
      collateralAsset,
      debtAsset,
      oracle,
      comptroller,
      cCollateral,
      cDebt
    };
  }

  it("enforces admin-only configuration and duplicate market protection", async function () {
    const { owner, other, oracle, comptroller, cCollateral } = await deployFixture();
    const newOracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(owner.address, ethers.ZeroAddress);

    expect(await comptroller.connect(other)._setPriceOracle.staticCall(newOracle.target)).to.equal(1);
    await expect(comptroller.connect(other)._setPriceOracle(newOracle.target))
      .to.emit(comptroller, "Failure")
      .withArgs(1, 16, 0);

    await expect(comptroller._setPriceOracle(newOracle.target)).to.emit(comptroller, "NewPriceOracle");
    expect(await comptroller.oracle()).to.equal(newOracle.target);

    expect(await comptroller.connect(other)._supportMarket.staticCall(cCollateral.target)).to.equal(1);
    await expect(comptroller.connect(other)._supportMarket(cCollateral.target))
      .to.emit(comptroller, "Failure")
      .withArgs(1, 18, 0);

    expect(await comptroller._supportMarket.staticCall(cCollateral.target)).to.equal(10);
    await expect(comptroller._supportMarket(cCollateral.target))
      .to.emit(comptroller, "Failure")
      .withArgs(10, 17, 0);
  });

  it("validates collateral factor constraints and pause guardian controls", async function () {
    const { owner, pauseGuardian, other, oracle, comptroller, cCollateral, cDebt, debtAsset } = await deployFixture();
    const freshToken = await (await ethers.getContractFactory("MockERC20")).deploy("Fresh", "FRH", 18);
    const delegate = await (await ethers.getContractFactory("CErc20Delegate")).deploy();
    const freshMarket = await (
      await ethers.getContractFactory("CErc20Delegator")
    ).deploy(
      freshToken.target,
      await comptroller.getAddress(),
      await cCollateral.interestRateModel(),
      ethers.parseEther("1"),
      "Fresh Market",
      "sFRH",
      8,
      owner.address,
      delegate.target,
      "0x"
    );

    expect(await comptroller.connect(other)._setCollateralFactor.staticCall(cCollateral.target, ethers.parseEther("0.5"))).to.equal(1);
    await expect(comptroller.connect(other)._setCollateralFactor(cCollateral.target, ethers.parseEther("0.5")))
      .to.emit(comptroller, "Failure")
      .withArgs(1, 6, 0);

    expect(await comptroller._setCollateralFactor.staticCall(cCollateral.target, ethers.parseEther("0.95"))).to.equal(6);
    await expect(comptroller._setCollateralFactor(cCollateral.target, ethers.parseEther("0.95")))
      .to.emit(comptroller, "Failure")
      .withArgs(6, 8, 0);

    expect(await comptroller._setCollateralFactor.staticCall(freshMarket.target, ethers.parseEther("0.5"))).to.equal(9);
    await expect(comptroller._setCollateralFactor(freshMarket.target, ethers.parseEther("0.5")))
      .to.emit(comptroller, "Failure")
      .withArgs(9, 7, 0);

    await oracle.postFallbackPrice(debtAsset.target, 0).catch(() => {});
    await oracle.setOracleType(debtAsset.target, 3);

    expect(await comptroller._setPauseGuardian.staticCall(pauseGuardian.address)).to.equal(0);
    await expect(comptroller._setPauseGuardian(pauseGuardian.address))
      .to.emit(comptroller, "NewPauseGuardian")
      .withArgs(ethers.ZeroAddress, pauseGuardian.address);

    await comptroller.connect(pauseGuardian)._setMintPaused(cCollateral.target, true);
    expect(await comptroller.mintGuardianPaused(cCollateral.target)).to.equal(true);
    await expect(comptroller.connect(pauseGuardian)._setMintPaused(cCollateral.target, false)).to.be.revertedWith(
      "only admin can unpause"
    );

    await comptroller.connect(pauseGuardian)._setBorrowPaused(cDebt.target, true);
    expect(await comptroller.borrowGuardianPaused(cDebt.target)).to.equal(true);
    await expect(comptroller.connect(other)._setBorrowPaused(cDebt.target, true)).to.be.revertedWith(
      "only pause guardian and admin can pause"
    );
  });

  it("tracks liquidity, auto-enters borrowed markets, and blocks unsafe exits", async function () {
    const { supplier, borrower, collateralAsset, debtAsset, comptroller, cCollateral, cDebt } = await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);

    const [errBefore, liquidityBefore, shortfallBefore] = await comptroller.getAccountLiquidity(borrower.address);
    expect(errBefore).to.equal(0);
    expect(liquidityBefore).to.equal(ethers.parseEther("75"));
    expect(shortfallBefore).to.equal(0);

    await cDebt.connect(borrower).borrow(ethers.parseEther("50"));
    expect(await comptroller.checkMembership(borrower.address, cDebt.target)).to.equal(true);

    const [errAfter, liquidityAfter, shortfallAfter] = await comptroller.getAccountLiquidity(borrower.address);
    expect(errAfter).to.equal(0);
    expect(liquidityAfter).to.equal(ethers.parseEther("25"));
    expect(shortfallAfter).to.equal(0);

    expect(await comptroller.connect(borrower).exitMarket.staticCall(cDebt.target)).to.equal(12);
    await expect(comptroller.connect(borrower).exitMarket(cDebt.target))
      .to.emit(comptroller, "Failure")
      .withArgs(12, 2, 0);

    expect(await comptroller.connect(borrower).exitMarket.staticCall(cCollateral.target)).to.equal(14);
    await expect(comptroller.connect(borrower).exitMarket(cCollateral.target))
      .to.emit(comptroller, "Failure");
  });

  it("computes seize tokens for liquidation and reports price failures", async function () {
    const { supplier, borrower, collateralAsset, debtAsset, oracle, comptroller, cCollateral, cDebt } = await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);

    await cDebt.connect(borrower).borrow(ethers.parseEther("60"));
    await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther("0.5"));

    const [errorCode, seizeTokens] = await comptroller.liquidateCalculateSeizeTokens(
      cDebt.target,
      cCollateral.target,
      ethers.parseEther("30")
    );
    expect(errorCode).to.equal(0);
    expect(seizeTokens).to.be.gt(0);

    await oracle.postFallbackPrice(collateralAsset.target, 1n);
    await oracle.setFallbackConfig(collateralAsset.target, 1);
    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);

    const [priceError, zeroSeize] = await comptroller.liquidateCalculateSeizeTokens(
      cDebt.target,
      cCollateral.target,
      ethers.parseEther("1")
    );
    expect(priceError).to.equal(13);
    expect(zeroSeize).to.equal(0);
  });

  it("enforces mint, redeem, and borrow policy hooks including borrow caps", async function () {
    const { owner, supplier, borrower, other, collateralAsset, debtAsset, comptroller, cCollateral, cDebt } =
      await deployFixture();

    expect(await comptroller.mintAllowed.staticCall(cCollateral.target, borrower.address, 1n)).to.equal(0);

    await comptroller._setPauseGuardian(owner.address);
    await comptroller._setMintPaused(cCollateral.target, true);
    await expect(comptroller.mintAllowed(cCollateral.target, borrower.address, 1n)).to.be.revertedWith("mint is paused");
    await comptroller._setMintPaused(cCollateral.target, false);

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));

    expect(await comptroller.redeemAllowed.staticCall(cCollateral.target, borrower.address, ethers.parseEther("10"))).to.equal(0);

    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("50"));

    expect(await comptroller.redeemAllowed.staticCall(cCollateral.target, borrower.address, ethers.parseEther("80"))).to.equal(4);

    await comptroller._setBorrowCapGuardian(other.address);
    await expect(
      comptroller.connect(borrower)._setMarketBorrowCaps([cDebt.target], [ethers.parseEther("10")])
    ).to.be.revertedWith("only admin or borrow cap guardian can set borrow caps");

    await comptroller.connect(other)._setMarketBorrowCaps([cDebt.target], [ethers.parseEther("50.5")]);
    expect(await comptroller.borrowCaps(cDebt.target)).to.equal(ethers.parseEther("50.5"));

    await expect(cDebt.connect(borrower).borrow(ethers.parseEther("1"))).to.be.revertedWith("market borrow cap reached");

    await comptroller._setBorrowPaused(cDebt.target, true);
    await expect(comptroller.borrowAllowed(cDebt.target, borrower.address, 1n)).to.be.revertedWith("borrow is paused");
  });

  it("enforces repay, liquidation, seize, and transfer policy checks", async function () {
    const { owner, supplier, borrower, liquidator, other, collateralAsset, debtAsset, oracle, comptroller, cCollateral, cDebt } =
      await deployFixture();

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("500"));
    await cDebt.connect(supplier).mint(ethers.parseEther("500"));

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("60"));

    expect(
      await comptroller.repayBorrowAllowed.staticCall(cDebt.target, liquidator.address, borrower.address, ethers.parseEther("1"))
    ).to.equal(0);

    expect(
      await comptroller.liquidateBorrowAllowed.staticCall(
        cDebt.target,
        cCollateral.target,
        liquidator.address,
        borrower.address,
        ethers.parseEther("1")
      )
    ).to.equal(3);

    await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther("0.5"));

    expect(
      await comptroller.liquidateBorrowAllowed.staticCall(
        cDebt.target,
        cCollateral.target,
        liquidator.address,
        borrower.address,
        ethers.parseEther("40")
      )
    ).to.equal(17);

    expect(
      await comptroller.liquidateBorrowAllowed.staticCall(
        cDebt.target,
        cCollateral.target,
        liquidator.address,
        borrower.address,
        ethers.parseEther("30")
      )
    ).to.equal(0);

    await comptroller._setPauseGuardian(owner.address);
    await comptroller._setSeizePaused(true);
    await expect(
      comptroller.seizeAllowed(cCollateral.target, cDebt.target, liquidator.address, borrower.address, 1n)
    ).to.be.revertedWith("seize is paused");
    await comptroller._setSeizePaused(false);

    await comptroller._setTransferPaused(true);
    await expect(
      comptroller.transferAllowed(cCollateral.target, borrower.address, liquidator.address, 1n)
    ).to.be.revertedWith("transfer is paused");
    await comptroller._setTransferPaused(false);

    const rogueComptrollerImpl = await (await ethers.getContractFactory("Comptroller")).deploy();
    const rogueUnitroller = await (await ethers.getContractFactory("Unitroller")).deploy();
    await rogueUnitroller._setPendingImplementation(rogueComptrollerImpl.target);
    await rogueComptrollerImpl._become(rogueUnitroller.target);
    const rogueComptroller = await ethers.getContractAt("Comptroller", rogueUnitroller.target);
    await rogueComptroller._setPriceOracle(await comptroller.oracle());

    const delegate = await (await ethers.getContractFactory("CErc20Delegate")).deploy();
    const rogueMarket = await (
      await ethers.getContractFactory("CErc20Delegator")
    ).deploy(
      collateralAsset.target,
      rogueUnitroller.target,
      await cCollateral.interestRateModel(),
      ethers.parseEther("1"),
      "Rogue Market",
      "rCOL",
      8,
      owner.address,
      delegate.target,
      "0x"
    );
    await rogueComptroller._supportMarket(rogueMarket.target);

    expect(
      await comptroller.seizeAllowed.staticCall(rogueMarket.target, cDebt.target, liquidator.address, borrower.address, 1n)
    ).to.equal(9);

    expect(
      await comptroller.transferAllowed.staticCall(cCollateral.target, borrower.address, liquidator.address, ethers.parseEther("80"))
    ).to.equal(4);

    expect(await comptroller.repayBorrowAllowed.staticCall(other.address, liquidator.address, borrower.address, 1n)).to.equal(9);
  });

  it("rejects invalid implementation addresses in CErc20Delegator._setImplementation", async function () {
    const { owner, cCollateral } = await deployFixture();
    const Delegate = await ethers.getContractFactory("CErc20Delegate");
    const newDelegate = await Delegate.deploy();

    await expect(
      cCollateral.connect(owner)._setImplementation(ethers.ZeroAddress, false, "0x")
    ).to.be.revertedWith("CErc20Delegator::_setImplementation: implementation=0");

    await expect(
      cCollateral.connect(owner)._setImplementation(owner.address, false, "0x")
    ).to.be.revertedWith("CErc20Delegator::_setImplementation: not a contract");

    await expect(
      cCollateral.connect(owner)._setImplementation(newDelegate.target, false, "0x")
    ).to.not.be.reverted;
  });
});
