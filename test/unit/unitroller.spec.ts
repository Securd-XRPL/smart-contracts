// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Unitroller", function () {
  it("handles pending implementation and admin transitions safely", async function () {
    const [admin, pendingAdmin, stranger] = await ethers.getSigners();
    const unitroller = await (await ethers.getContractFactory("Unitroller")).deploy();
    const comptrollerImpl = await (await ethers.getContractFactory("Comptroller")).deploy();

    expect(await unitroller.admin()).to.equal(admin.address);

    expect(await unitroller.connect(stranger)._setPendingImplementation.staticCall(comptrollerImpl.target)).to.equal(1);
    await expect(unitroller.connect(stranger)._setPendingImplementation(comptrollerImpl.target))
      .to.emit(unitroller, "Failure")
      .withArgs(1, 15, 0);

    expect(await unitroller._setPendingImplementation.staticCall(comptrollerImpl.target)).to.equal(0);
    await expect(unitroller._setPendingImplementation(comptrollerImpl.target))
      .to.emit(unitroller, "NewPendingImplementation")
      .withArgs(ethers.ZeroAddress, comptrollerImpl.target);
    expect(await unitroller.pendingComptrollerImplementation()).to.equal(comptrollerImpl.target);

    expect(await unitroller.connect(stranger)._acceptImplementation.staticCall()).to.equal(1);
    await expect(unitroller.connect(stranger)._acceptImplementation())
      .to.emit(unitroller, "Failure")
      .withArgs(1, 1, 0);

    await comptrollerImpl._become(unitroller.target);
    expect(await unitroller.comptrollerImplementation()).to.equal(comptrollerImpl.target);
    expect(await unitroller.pendingComptrollerImplementation()).to.equal(ethers.ZeroAddress);

    expect(await unitroller.connect(stranger)._setPendingAdmin.staticCall(pendingAdmin.address)).to.equal(1);
    await expect(unitroller.connect(stranger)._setPendingAdmin(pendingAdmin.address))
      .to.emit(unitroller, "Failure")
      .withArgs(1, 14, 0);

    expect(await unitroller._setPendingAdmin.staticCall(pendingAdmin.address)).to.equal(0);
    await expect(unitroller._setPendingAdmin(pendingAdmin.address))
      .to.emit(unitroller, "NewPendingAdmin")
      .withArgs(ethers.ZeroAddress, pendingAdmin.address);

    expect(await unitroller.connect(stranger)._acceptAdmin.staticCall()).to.equal(1);
    await expect(unitroller.connect(stranger)._acceptAdmin())
      .to.emit(unitroller, "Failure")
      .withArgs(1, 0, 0);

    expect(await unitroller.connect(pendingAdmin)._acceptAdmin.staticCall()).to.equal(0);
    await expect(unitroller.connect(pendingAdmin)._acceptAdmin())
      .to.emit(unitroller, "NewAdmin")
      .withArgs(admin.address, pendingAdmin.address);

    expect(await unitroller.admin()).to.equal(pendingAdmin.address);
    expect(await unitroller.pendingAdmin()).to.equal(ethers.ZeroAddress);
  });

  it("delegates comptroller calls through the fallback once an implementation is installed", async function () {
    const [admin] = await ethers.getSigners();
    const unitroller = await (await ethers.getContractFactory("Unitroller")).deploy();
    const comptrollerImpl = await (await ethers.getContractFactory("Comptroller")).deploy();
    const oracle = await (await ethers.getContractFactory("SecurdPriceOracle")).deploy(admin.address, ethers.ZeroAddress);

    await unitroller._setPendingImplementation(comptrollerImpl.target);
    await comptrollerImpl._become(unitroller.target);

    const proxiedComptroller = await ethers.getContractAt("Comptroller", unitroller.target);
    await proxiedComptroller._setPriceOracle(oracle.target);
    await proxiedComptroller._setCloseFactor(ethers.parseEther("0.5"));

    expect(await proxiedComptroller.oracle()).to.equal(oracle.target);
    expect(await proxiedComptroller.closeFactorMantissa()).to.equal(ethers.parseEther("0.5"));
  });
});
