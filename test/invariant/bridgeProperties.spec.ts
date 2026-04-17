// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";
import { ActionType, randomIntentId, signIntent } from "../helpers";

function encodeSignedIntent(signedIntent: { envelope: any; signature: string }) {
  const e = signedIntent.envelope;
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)"],
    [[[
      e.intentId,
      e.xrplAccount,
      e.market,
      e.underlying,
      e.actionType,
      e.amount,
      e.nonce,
      e.deadline,
      e.destinationAddress,
      e.version
    ], signedIntent.signature]]
  );
}

describe("Bridge safety properties", function () {
  async function deployFixture() {
    const [owner, signer] = await ethers.getSigners();
    const its = await (await ethers.getContractFactory("MockInterchainTokenService")).deploy();
    const gateway = await (await ethers.getContractFactory("MockGateway")).deploy();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("Wrapped USDC", "wUSDC", 6);
    const market = await (await ethers.getContractFactory("MockCErc20Market")).deploy(token.target);
    const factory = await (await ethers.getContractFactory("XRPLUserProxyFactory")).deploy(owner.address, owner.address);
    const adapter = await (
      await ethers.getContractFactory("XRPLSecurdBridgeAdapter")
    ).deploy(owner.address, gateway.target, its.target, factory.target, "xrpl");

    await factory.setController(adapter.target);
    await adapter.setTrustedItsSource("xrpl-ledger", ethers.toUtf8Bytes("source-app"), true);

    const tokenId = ethers.keccak256(ethers.toUtf8Bytes("USDC"));
    await adapter.setMarket(market.target, token.target, tokenId, true);

    const xrplAccount = ethers.encodeBytes32String("alice");
    await adapter.setIntentSigner(xrplAccount, signer.address);

    await token.mint(adapter.target, 10_000_000n);
    await token.mint(market.target, 10_000_000n);
    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);

    return { signer, its, token, market, adapter, tokenId, xrplAccount };
  }

  it("advances nonce exactly once per accepted sequential intent", async function () {
    const { signer, its, token, market, adapter, tokenId, xrplAccount } = await deployFixture();
    const itsSigner = await ethers.getImpersonatedSigner(its.target as string);

    for (let nonce = 0; nonce < 5; nonce += 1) {
      const envelope = {
        intentId: randomIntentId(`seq-${nonce}`),
        xrplAccount,
        market: market.target as string,
        underlying: token.target as string,
        actionType: ActionType.SUPPLY,
        amount: BigInt(1000 + nonce),
        nonce,
        deadline: 0,
        destinationAddress: "0x",
        version: 1
      };

      await adapter.connect(itsSigner).executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        encodeSignedIntent(await signIntent(adapter.target as string, signer, envelope)),
        tokenId,
        token.target,
        envelope.amount
      );

      expect(await adapter.nextNonceByXrplAccount(xrplAccount)).to.equal(nonce + 1);
    }
  });

  it("preserves idempotency and ordering under duplicate and out-of-order deliveries", async function () {
    const { signer, its, token, market, adapter, tokenId, xrplAccount } = await deployFixture();
    const itsSigner = await ethers.getImpersonatedSigner(its.target as string);

    const first = {
      intentId: randomIntentId("ordered-0"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 5000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    const second = {
      intentId: randomIntentId("ordered-1"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 6000n,
      nonce: 1,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    const firstPayload = encodeSignedIntent(await signIntent(adapter.target as string, signer, first));
    const secondPayload = encodeSignedIntent(await signIntent(adapter.target as string, signer, second));

    await adapter.connect(itsSigner).executeWithInterchainToken(
      ethers.ZeroHash,
      "xrpl-ledger",
      ethers.toUtf8Bytes("source-app"),
      firstPayload,
      tokenId,
      token.target,
      first.amount
    );
    expect(await adapter.nextNonceByXrplAccount(xrplAccount)).to.equal(1);

    await expect(
      adapter.connect(itsSigner).executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        firstPayload,
        tokenId,
        token.target,
        first.amount
      )
    ).to.emit(adapter, "IntentDuplicateIgnored");
    expect(await adapter.nextNonceByXrplAccount(xrplAccount)).to.equal(1);

    const future = {
      intentId: randomIntentId("ordered-3"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 7000n,
      nonce: 3,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    await expect(
      adapter.connect(itsSigner).executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        encodeSignedIntent(await signIntent(adapter.target as string, signer, future)),
        tokenId,
        token.target,
        future.amount
      )
    ).to.be.revertedWithCustomError(adapter, "InvalidNonce");
    expect(await adapter.nextNonceByXrplAccount(xrplAccount)).to.equal(1);

    await adapter.connect(itsSigner).executeWithInterchainToken(
      ethers.ZeroHash,
      "xrpl-ledger",
      ethers.toUtf8Bytes("source-app"),
      secondPayload,
      tokenId,
      token.target,
      second.amount
    );
    expect(await adapter.nextNonceByXrplAccount(xrplAccount)).to.equal(2);
  });
});
