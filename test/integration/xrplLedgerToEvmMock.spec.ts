import { expect } from "chai";
import { ethers } from "hardhat";

describe("XRPL Ledger to XRPL EVM mock receiver", function () {
  async function deployFixture() {
    const [owner, relayer] = await ethers.getSigners();
    const gateway = await (await ethers.getContractFactory("MockGateway")).deploy();
    const receiver = await (
      await ethers.getContractFactory("MockXrplEvmReceiver")
    ).deploy(owner.address, gateway.target);

    const sourceChain = "xrpl-ledger";
    const sourceAddress = "source-app";
    await receiver.connect(owner).setTrustedSource(sourceChain, sourceAddress, true);

    return { owner, relayer, gateway, receiver, sourceChain, sourceAddress };
  }

  function encodeXrplPaymentPayload(xrplAccount: string, memo: string, amount: bigint) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "string", "uint256"],
      [xrplAccount, memo, amount]
    );
  }

  it("accepts a validated XRPL Ledger source message on XRPL EVM", async function () {
    const { gateway, receiver, sourceChain, sourceAddress } = await deployFixture();
    const xrplAccount = ethers.encodeBytes32String("alice-xrpl");
    const memo = "SECURD:MOCK_SUPPLY";
    const amount = 1_000_000n;
    const payload = encodeXrplPaymentPayload(xrplAccount, memo, amount);
    const commandId = ethers.keccak256(ethers.toUtf8Bytes("xrpl-ledger-payment-1"));

    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);
    await expect(
      receiver
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(commandId, sourceChain, sourceAddress, payload)
    )
      .to.emit(receiver, "XrplLedgerMessageReceived")
      .withArgs(commandId, sourceChain, sourceAddress, xrplAccount, memo, amount);

    const lastMessage = await receiver.lastReceivedMessage();
    expect(lastMessage.commandId).to.equal(commandId);
    expect(lastMessage.sourceChain).to.equal(sourceChain);
    expect(lastMessage.sourceAddress).to.equal(sourceAddress);
    expect(lastMessage.xrplAccount).to.equal(xrplAccount);
    expect(lastMessage.memo).to.equal(memo);
    expect(lastMessage.amount).to.equal(amount);
    expect(lastMessage.payload).to.equal(payload);
  });

  it("rejects direct calls that do not come from the Axelar gateway", async function () {
    const { relayer, receiver, sourceChain, sourceAddress } = await deployFixture();
    const payload = encodeXrplPaymentPayload(ethers.encodeBytes32String("alice-xrpl"), "SECURD:MOCK_SUPPLY", 1n);

    await expect(
      receiver.connect(relayer).execute(ethers.ZeroHash, sourceChain, sourceAddress, payload)
    ).to.be.revertedWithCustomError(receiver, "NotGateway");
  });

  it("rejects gateway calls that were not approved or are from untrusted XRPL sources", async function () {
    const { owner, gateway, receiver, sourceChain, sourceAddress } = await deployFixture();
    const payload = encodeXrplPaymentPayload(ethers.encodeBytes32String("alice-xrpl"), "SECURD:MOCK_SUPPLY", 1n);
    const gatewaySigner = await ethers.getImpersonatedSigner(gateway.target as string);

    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);
    await gateway.setNextValidationResult(false);
    await expect(
      receiver.connect(gatewaySigner).execute(ethers.ZeroHash, sourceChain, sourceAddress, payload)
    ).to.be.revertedWithCustomError(receiver, "NotApprovedByGateway");

    await gateway.setNextValidationResult(true);
    await receiver.connect(owner).setTrustedSource(sourceChain, sourceAddress, false);
    await expect(
      receiver.connect(gatewaySigner).execute(ethers.ZeroHash, sourceChain, sourceAddress, payload)
    ).to.be.revertedWithCustomError(receiver, "UntrustedSource");
  });
});
