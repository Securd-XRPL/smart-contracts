// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

describe("XRPL user proxies", function () {
  it("deploys deterministic proxies and freezes controller rotation after first proxy", async function () {
    const [owner, controller, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("XRPLUserProxyFactory");
    const factory = await Factory.deploy(owner.address, controller.address);

    await expect(factory.connect(other).setController(other.address)).to.be.reverted;
    await expect(factory.connect(owner).setController(other.address))
      .to.emit(factory, "ControllerSet")
      .withArgs(controller.address, other.address);

    const xrplAccount = ethers.encodeBytes32String("alice");
    const predicted = await factory.predictProxy(xrplAccount);
    await factory.connect(other).getOrCreateProxy(xrplAccount);
    expect(await factory.proxyOf(xrplAccount)).to.equal(predicted);
    expect(await factory.proxyCount()).to.equal(1);

    await expect(factory.connect(owner).setController(controller.address)).to.be.revertedWithCustomError(
      factory,
      "ControllerFrozen"
    );
  });

  it("allows only the controller to execute and sweep", async function () {
    const [controller, other, recipient] = await ethers.getSigners();
    const Proxy = await ethers.getContractFactory("XRPLUserProxy");
    const proxy = await Proxy.deploy(controller.address, ethers.encodeBytes32String("bob"));

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock", "MOCK", 18);
    await token.mint(proxy.target, 1000n);

    await expect(proxy.connect(other).execute(token.target, 0, "0x")).to.be.revertedWithCustomError(proxy, "NotController");
    await expect(proxy.connect(other).sweepToken(token.target, recipient.address, 100n)).to.be.revertedWithCustomError(
      proxy,
      "NotController"
    );

    await proxy.connect(controller).sweepToken(token.target, recipient.address, 100n);
    expect(await token.balanceOf(recipient.address)).to.equal(100n);
  });
});
