// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";

const MIN_DELAY = 48 * 3600; // 48 hours in seconds
const GRACE_PERIOD = 7 * 24 * 3600; // 7 days
const SET_CF_SELECTOR = "0xe4028eee"; // _setCollateralFactor(address,uint256)

function encodeSetCollateralFactor(cToken: string, factor: bigint): string {
  return ethers.concat([
    SET_CF_SELECTOR,
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [cToken, factor])
  ]);
}

describe("SecurdCollateralFactorTimelock", function () {
  async function deployFixture() {
    const [owner, other] = await ethers.getSigners();
    const timelock = await (await ethers.getContractFactory("SecurdCollateralFactorTimelock")).deploy(owner.address);
    const mock = await (await ethers.getContractFactory("MockComptrollerAdmin")).deploy();
    return { owner, other, timelock, mock };
  }

  it("accepts Unitroller admin via acceptUnitrollerAdmin", async function () {
    const { owner, timelock, mock } = await deployFixture();

    // Current mock admin (owner) sets timelock as pending admin
    await mock._setPendingAdmin(await timelock.getAddress());
    expect(await mock.pendingAdmin()).to.equal(await timelock.getAddress());

    // Timelock accepts
    await timelock.acceptUnitrollerAdmin(await mock.getAddress());
    expect(await mock.admin()).to.equal(await timelock.getAddress());
  });

  it("rejects acceptUnitrollerAdmin from non-owner", async function () {
    const { other, timelock, mock } = await deployFixture();
    await mock._setPendingAdmin(await timelock.getAddress());
    await expect(timelock.connect(other).acceptUnitrollerAdmin(await mock.getAddress())).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it("requires MIN_DELAY for collateral factor changes", async function () {
    const { timelock, mock } = await deployFixture();
    const cToken = ethers.Wallet.createRandom().address;
    const data = encodeSetCollateralFactor(cToken, ethers.parseEther("0.75"));

    // Delay below minimum is rejected
    await expect(
      timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY - 1)
    ).to.be.revertedWithCustomError(timelock, "DelayTooShort");

    // Exactly minimum is accepted
    await expect(
      timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY)
    ).to.emit(timelock, "ActionQueued");
  });

  it("allows non-collateral-factor calls with zero delay", async function () {
    const { timelock, mock } = await deployFixture();
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0]); // arbitrary non-CF call

    const tx = await timelock.queue(await mock.getAddress(), 0, data, 0);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => l.fragment?.name === "ActionQueued");
    expect(event).to.not.be.undefined;
  });

  it("executes a collateral factor change after MIN_DELAY", async function () {
    const { timelock, mock } = await deployFixture();
    await mock._setPendingAdmin(await timelock.getAddress());
    await timelock.acceptUnitrollerAdmin(await mock.getAddress());

    const cToken = ethers.Wallet.createRandom().address;
    const newFactor = ethers.parseEther("0.7");
    const data = encodeSetCollateralFactor(cToken, newFactor);

    const tx = await timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => l.fragment?.name === "ActionQueued");
    const actionId = event.args.actionId;

    // Not yet executable
    await expect(timelock.execute(actionId)).to.be.revertedWithCustomError(timelock, "ActionNotReady");

    // Advance time past the delay
    await ethers.provider.send("evm_increaseTime", [MIN_DELAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(timelock.execute(actionId)).to.emit(timelock, "ActionExecuted");

    expect(await mock.lastCollateralFactorCToken()).to.equal(cToken);
    expect(await mock.lastCollateralFactorMantissa()).to.equal(newFactor);
  });

  it("prevents execution after the grace period expires", async function () {
    const { timelock, mock } = await deployFixture();
    const cToken = ethers.Wallet.createRandom().address;
    const data = encodeSetCollateralFactor(cToken, ethers.parseEther("0.7"));

    const tx = await timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY);
    const receipt = await tx.wait();
    const actionId = receipt.logs.find((l: any) => l.fragment?.name === "ActionQueued").args.actionId;

    // Advance past delay + grace period
    await ethers.provider.send("evm_increaseTime", [MIN_DELAY + GRACE_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(timelock.execute(actionId)).to.be.revertedWithCustomError(timelock, "ActionExpired");
  });

  it("cancels a queued action before execution", async function () {
    const { timelock, mock } = await deployFixture();
    const cToken = ethers.Wallet.createRandom().address;
    const data = encodeSetCollateralFactor(cToken, ethers.parseEther("0.7"));

    const tx = await timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY);
    const actionId = (await tx.wait()).logs.find((l: any) => l.fragment?.name === "ActionQueued").args.actionId;

    await expect(timelock.cancel(actionId)).to.emit(timelock, "ActionCancelled");

    // After cancellation, action no longer exists
    await ethers.provider.send("evm_increaseTime", [MIN_DELAY]);
    await ethers.provider.send("evm_mine", []);
    await expect(timelock.execute(actionId)).to.be.revertedWithCustomError(timelock, "ActionNotQueued");
  });

  it("stores queued action state and rejects the same actionId after re-queuing", async function () {
    const { timelock, mock } = await deployFixture();
    const cToken = ethers.Wallet.createRandom().address;
    const data = encodeSetCollateralFactor(cToken, ethers.parseEther("0.7"));

    // Queue once — action must be stored
    const tx = await timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => l.fragment?.name === "ActionQueued");
    const actionId = event.args.actionId;

    const stored = await timelock.queuedActions(actionId);
    expect(stored.exists).to.be.true;
    expect(stored.target).to.equal(await mock.getAddress());

    // Cancel and re-queue — since the timestamp is now different, a new actionId is produced
    await timelock.cancel(actionId);
    const tx2 = await timelock.queue(await mock.getAddress(), 0, data, MIN_DELAY);
    const receipt2 = await tx2.wait();
    const actionId2 = receipt2.logs.find((l: any) => l.fragment?.name === "ActionQueued").args.actionId;

    // New actionId because a new block has a different timestamp → different eta
    expect(actionId2).to.not.equal(actionId);
    // First action no longer exists; second does
    expect((await timelock.queuedActions(actionId)).exists).to.be.false;
    expect((await timelock.queuedActions(actionId2)).exists).to.be.true;
  });

  it("rejects delay above MAX_DELAY", async function () {
    const { timelock, mock } = await deployFixture();
    const MAX_DELAY = 30 * 24 * 3600;
    const data = encodeSetCollateralFactor(ethers.Wallet.createRandom().address, ethers.parseEther("0.7"));

    await expect(
      timelock.queue(await mock.getAddress(), 0, data, MAX_DELAY + 1)
    ).to.be.revertedWithCustomError(timelock, "DelayTooLong");
  });

  it("only owner can queue, execute, and cancel", async function () {
    const { other, timelock, mock } = await deployFixture();
    const data = encodeSetCollateralFactor(ethers.Wallet.createRandom().address, ethers.parseEther("0.7"));

    await expect(
      timelock.connect(other).queue(await mock.getAddress(), 0, data, MIN_DELAY)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(timelock.connect(other).execute(ethers.ZeroHash)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect(timelock.connect(other).cancel(ethers.ZeroHash)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });
});
