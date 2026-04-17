// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Lending safety properties", function () {
  async function deployFixture() {
    const [owner, supplier, borrower, liquidator] = await ethers.getSigners();

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

    for (const asset of [collateralAsset, debtAsset]) {
      await oracle.setFallbackConfig(asset.target, 86400);
      await oracle.setOracleType(asset.target, 3);
      await oracle.postFallbackPrice(asset.target, ethers.parseEther("1"));
    }

    await comptroller._setCollateralFactor(cCollateral.target, ethers.parseEther("0.75"));
    await comptroller._setCollateralFactor(cDebt.target, 0);

    await collateralAsset.mint(borrower.address, ethers.parseEther("500"));
    await debtAsset.mint(supplier.address, ethers.parseEther("5000"));
    await debtAsset.mint(liquidator.address, ethers.parseEther("5000"));

    await debtAsset.connect(supplier).approve(cDebt.target, ethers.parseEther("5000"));
    await cDebt.connect(supplier).mint(ethers.parseEther("5000"));

    return { borrower, liquidator, collateralAsset, debtAsset, oracle, comptroller, cCollateral, cDebt };
  }

  it("maintains monotonic liquidity and shortfall relationships across collateral prices", async function () {
    const { borrower, collateralAsset, oracle, comptroller, cCollateral, cDebt } = await deployFixture();

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("200"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("200"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("80"));

    const prices = ["1.25", "1.00", "0.80", "0.60", "0.40"];
    let previousLiquidity = 2n ** 255n;
    let previousShortfall = 0n;

    for (const price of prices) {
      await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther(price));
      const [, liquidity, shortfall] = await comptroller.getAccountLiquidity(borrower.address);

      expect(liquidity === 0n || shortfall === 0n).to.equal(true);
      expect(liquidity).to.be.lte(previousLiquidity);
      expect(shortfall).to.be.gte(previousShortfall);

      previousLiquidity = liquidity;
      previousShortfall = shortfall;
    }
  });

  it("only allows liquidation when shortfall exists and repay amount stays within close factor", async function () {
    const { borrower, liquidator, collateralAsset, debtAsset, oracle, comptroller, cCollateral, cDebt } = await deployFixture();

    await collateralAsset.connect(borrower).approve(cCollateral.target, ethers.parseEther("100"));
    await cCollateral.connect(borrower).mint(ethers.parseEther("100"));
    await comptroller.connect(borrower).enterMarkets([cCollateral.target]);
    await cDebt.connect(borrower).borrow(ethers.parseEther("60"));

    const attempts = [ethers.parseEther("1"), ethers.parseEther("10"), ethers.parseEther("30"), ethers.parseEther("40")];

    for (const repayAmount of attempts) {
      expect(
        await comptroller.liquidateBorrowAllowed.staticCall(
          cDebt.target,
          cCollateral.target,
          liquidator.address,
          borrower.address,
          repayAmount
        )
      ).to.equal(3);
    }

    await oracle.postFallbackPrice(collateralAsset.target, ethers.parseEther("0.5"));

    const expected = new Map<string, bigint>([
      [ethers.parseEther("1").toString(), 0n],
      [ethers.parseEther("10").toString(), 0n],
      [ethers.parseEther("30").toString(), 0n],
      [ethers.parseEther("40").toString(), 17n]
    ]);

    for (const repayAmount of attempts) {
      expect(
        await comptroller.liquidateBorrowAllowed.staticCall(
          cDebt.target,
          cCollateral.target,
          liquidator.address,
          borrower.address,
          repayAmount
        )
      ).to.equal(expected.get(repayAmount.toString()));
    }

    await debtAsset.connect(liquidator).approve(cDebt.target, ethers.parseEther("30"));
    await cDebt.connect(liquidator).liquidateBorrow(borrower.address, ethers.parseEther("30"), cCollateral.target);
    expect(await cDebt.borrowBalanceStored(borrower.address)).to.equal(ethers.parseEther("30"));
  });
});
