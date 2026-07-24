// @ts-nocheck
import { expect } from "chai";
import { ethers } from "hardhat";
import { ActionType, randomIntentId, signIntent } from "../helpers";

const LIVE_XRPL_EVM_TESTNET_ITS = "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C";
const STALE_XRPL_EVM_TESTNET_ITS = "0x000000000000000000000000000000000000dEaD";

function encodeSignedIntent(signedIntent: { envelope: any; signature: string }) {
  const e = signedIntent.envelope;
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(tuple(bytes32,bytes32,address,address,uint8,uint256,uint64,uint64,bytes,uint16),bytes)"
    ],
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

describe("XRPLSecurdBridgeAdapter integration", function () {
  async function deployFixture() {
    const [owner, signer] = await ethers.getSigners();
    const gateway = await (await ethers.getContractFactory("MockGateway")).deploy();
    const its = await (await ethers.getContractFactory("MockInterchainTokenService")).deploy();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("Wrapped USDC", "wUSDC", 6);
    const market = await (await ethers.getContractFactory("MockCErc20Market")).deploy(token.target);
    const factory = await (await ethers.getContractFactory("XRPLUserProxyFactory")).deploy(owner.address, owner.address);
    const adapter = await (
      await ethers.getContractFactory("XRPLSecurdBridgeAdapter")
    ).deploy(owner.address, gateway.target, its.target, factory.target, "xrpl");

    await factory.connect(owner).setController(adapter.target);
    await adapter.setTrustedGmpSource("xrpl-ledger", "source-app", true);
    await adapter.setTrustedItsSource("xrpl-ledger", ethers.toUtf8Bytes("source-app"), true);

    const tokenId = ethers.keccak256(ethers.toUtf8Bytes("USDC"));
    await adapter.setMarket(market.target, token.target, tokenId, true);

    const xrplAccount = ethers.encodeBytes32String("alice");
    await adapter.setIntentSigner(xrplAccount, signer.address);

    await token.mint(adapter.target, 1_000_000n);
    await token.mint(market.target, 1_000_000n);

    return { owner, signer, gateway, its, token, market, factory, adapter, tokenId, xrplAccount };
  }

  it("processes supply through ITS and ignores exact duplicates", async function () {
    const { signer, its, token, market, factory, adapter, tokenId, xrplAccount } = await deployFixture();

    const envelope = {
      intentId: randomIntentId("supply-1"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 50_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };
    const signedIntent = await signIntent(adapter.target as string, signer, envelope);
    const payload = encodeSignedIntent(signedIntent);

    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          payload,
          tokenId,
          token.target,
          50_000n
        )
    ).to.emit(adapter, "IntentExecuted");

    expect(await adapter.nextNonceByXrplAccount(xrplAccount)).to.equal(1);

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          payload,
          tokenId,
          token.target,
          50_000n
        )
    ).to.emit(adapter, "IntentDuplicateIgnored");

    const proxyAddress = await factory.proxyOf(xrplAccount);
    expect(proxyAddress).to.not.equal(ethers.ZeroAddress);
  });

  it("requires the live XRPL EVM testnet ITS sender for token ingress", async function () {
    const [owner, signer] = await ethers.getSigners();
    const gateway = await (await ethers.getContractFactory("MockGateway")).deploy();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("Wrapped XRP", "wXRP", 18);
    const market = await (await ethers.getContractFactory("MockCErc20Market")).deploy(token.target);
    const factory = await (await ethers.getContractFactory("XRPLUserProxyFactory")).deploy(owner.address, owner.address);
    const adapter = await (
      await ethers.getContractFactory("XRPLSecurdBridgeAdapter")
    ).deploy(owner.address, gateway.target, LIVE_XRPL_EVM_TESTNET_ITS, factory.target, "xrpl");

    await factory.connect(owner).setController(adapter.target);
    await adapter.setTrustedItsSource("xrpl", ethers.toUtf8Bytes("source-app"), true);

    const tokenId = "0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f";
    await adapter.setMarket(market.target, token.target, tokenId, true);

    const xrplAccount = ethers.encodeBytes32String("alice");
    await adapter.setIntentSigner(xrplAccount, signer.address);
    await token.mint(adapter.target, 1_000_000n);

    const envelope = {
      intentId: randomIntentId("live-testnet-its-supply"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 50_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };
    const payload = encodeSignedIntent(await signIntent(adapter.target as string, signer, envelope));

    await ethers.provider.send("hardhat_setBalance", [STALE_XRPL_EVM_TESTNET_ITS, "0x1000000000000000000"]);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(STALE_XRPL_EVM_TESTNET_ITS))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl",
          ethers.toUtf8Bytes("source-app"),
          payload,
          tokenId,
          token.target,
          envelope.amount
        )
    ).to.be.revertedWithCustomError(adapter, "NotInterchainTokenService");

    await ethers.provider.send("hardhat_setBalance", [LIVE_XRPL_EVM_TESTNET_ITS, "0x1000000000000000000"]);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(LIVE_XRPL_EVM_TESTNET_ITS))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl",
          ethers.toUtf8Bytes("source-app"),
          payload,
          tokenId,
          token.target,
          envelope.amount
        )
    ).to.emit(adapter, "IntentExecuted");
  });

  it("processes borrow through GMP and initiates egress", async function () {
    const { signer, gateway, its, token, market, adapter, tokenId, xrplAccount } = await deployFixture();

    await ethers.provider.send("hardhat_setBalance", [adapter.target, "0x2386F26FC10000"]);
    await adapter.setEgressGasValue(1234n);

    const envelope = {
      intentId: randomIntentId("borrow-1"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.BORROW,
      amount: 10_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: ethers.hexlify(ethers.toUtf8Bytes("rDestination")),
      version: 1
    };
    const signedIntent = await signIntent(adapter.target as string, signer, envelope);
    const payload = encodeSignedIntent(signedIntent);

    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(ethers.ZeroHash, "xrpl-ledger", "source-app", payload)
    )
      .to.emit(adapter, "IntentExecuted")
      .and.to.emit(adapter, "EgressInitiated");

    const transfer = await its.lastTransfer();
    expect(transfer.tokenId).to.equal(tokenId);
    expect(transfer.amount).to.equal(10_000n);
  });

  it("rejects invalid signatures and bad sources", async function () {
    const { owner, gateway, token, market, adapter, xrplAccount } = await deployFixture();
    const [,, attacker] = await ethers.getSigners();

    const envelope = {
      intentId: randomIntentId("bad-borrow"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.BORROW,
      amount: 1n,
      nonce: 0,
      deadline: 0,
      destinationAddress: ethers.hexlify(ethers.toUtf8Bytes("rDest")),
      version: 1
    };
    const signedIntent = await signIntent(adapter.target as string, attacker, envelope);
    const payload = encodeSignedIntent(signedIntent);

    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(ethers.ZeroHash, "xrpl-ledger", "source-app", payload)
    ).to.be.revertedWithCustomError(adapter, "InvalidIntentSignature");

    await adapter.connect(owner).setTrustedGmpSource("xrpl-ledger", "source-app", false);

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(ethers.ZeroHash, "xrpl-ledger", "source-app", payload)
    ).to.be.revertedWithCustomError(adapter, "UntrustedSource");
  });

  it("rejects expired intents and unsupported ingress paths", async function () {
    const { signer, gateway, its, token, market, adapter, tokenId, xrplAccount } = await deployFixture();
    const latest = await ethers.provider.getBlock("latest");

    const expiredSupply = {
      intentId: randomIntentId("expired-supply"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 1_000n,
      nonce: 0,
      deadline: Number(latest!.timestamp) - 1,
      destinationAddress: "0x",
      version: 1
    };

    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          encodeSignedIntent(await signIntent(adapter.target as string, signer, expiredSupply)),
          tokenId,
          token.target,
          expiredSupply.amount
        )
    ).to.be.revertedWithCustomError(adapter, "DeadlineExpired");

    const wrongPath = {
      intentId: randomIntentId("supply-via-gmp"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: ethers.hexlify(ethers.toUtf8Bytes("rDest")),
      version: 1
    };

    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(
          ethers.ZeroHash,
          "xrpl-ledger",
          "source-app",
          encodeSignedIntent(await signIntent(adapter.target as string, signer, wrongPath))
        )
    ).to.be.revertedWithCustomError(adapter, "UnsupportedIngressPath");
  });

  it("rejects ITS token metadata mismatches", async function () {
    const { signer, its, token, market, adapter, tokenId, xrplAccount } = await deployFixture();
    const envelope = {
      intentId: randomIntentId("supply-mismatch"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 50_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };
    const payload = encodeSignedIntent(await signIntent(adapter.target as string, signer, envelope));

    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          payload,
          ethers.keccak256(ethers.toUtf8Bytes("BAD")),
          token.target,
          envelope.amount
        )
    ).to.be.revertedWithCustomError(adapter, "TokenIdMismatch");

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          payload,
          tokenId,
          token.target,
          envelope.amount + 1n
        )
    ).to.be.revertedWithCustomError(adapter, "AmountMismatch");
  });

  it("bubbles execution failures from market and egress calls", async function () {
    const { signer, gateway, token, market, adapter, xrplAccount } = await deployFixture();

    await ethers.provider.send("hardhat_setBalance", [adapter.target, "0x2386F26FC10000"]);
    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);

    await market.setResults(0, 0, 0, 7, 0);
    const withdrawIntent = {
      intentId: randomIntentId("withdraw-fails"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.WITHDRAW,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: ethers.hexlify(ethers.toUtf8Bytes("rDest")),
      version: 1
    };

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(
          ethers.ZeroHash,
          "xrpl-ledger",
          "source-app",
          encodeSignedIntent(await signIntent(adapter.target as string, signer, withdrawIntent))
        )
    ).to.be.revertedWithCustomError(adapter, "SecurdCallFailed");

    await market.setResults(0, 0, 0, 0, 0);
    await token.setFailTransfers(true);
    const borrowIntent = {
      intentId: randomIntentId("borrow-transfer-revert"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.BORROW,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: ethers.hexlify(ethers.toUtf8Bytes("rDest")),
      version: 1
    };

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(
          ethers.ZeroHash,
          "xrpl-ledger",
          "source-app",
          encodeSignedIntent(await signIntent(adapter.target as string, signer, borrowIntent))
        )
    ).to.be.reverted;
  });

  it("rejects empty egress destinations and token approval false returns", async function () {
    const { owner, signer, gateway, its, market, factory, adapter, tokenId, xrplAccount } = await deployFixture();
    const falseApproveToken = await (
      await ethers.getContractFactory("MockERC20ApproveFalse")
    ).deploy("Wrapped USDC", "wUSDC", 6);

    await adapter.setMarket(market.target, falseApproveToken.target, tokenId, true);
    await falseApproveToken.mint(adapter.target, 100_000n);
    await falseApproveToken.mint(market.target, 100_000n);
    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);

    const withdrawIntent = {
      intentId: randomIntentId("withdraw-no-dest"),
      xrplAccount,
      market: market.target as string,
      underlying: falseApproveToken.target as string,
      actionType: ActionType.WITHDRAW,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(
          ethers.ZeroHash,
          "xrpl-ledger",
          "source-app",
          encodeSignedIntent(await signIntent(adapter.target as string, signer, withdrawIntent))
        )
    ).to.be.revertedWithCustomError(adapter, "InvalidDestinationAddress");

    const freshAccount = ethers.encodeBytes32String("bob");
    await adapter.connect(owner).setIntentSigner(freshAccount, signer.address);
    const supplyIntent = {
      intentId: randomIntentId("supply-false-approve"),
      xrplAccount: freshAccount,
      market: market.target as string,
      underlying: falseApproveToken.target as string,
      actionType: ActionType.SUPPLY,
      amount: 5_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          encodeSignedIntent(await signIntent(adapter.target as string, signer, supplyIntent)),
          tokenId,
          falseApproveToken.target,
          supplyIntent.amount
        )
    ).to.be.revertedWithCustomError(adapter, "ProxyTokenCallFailed");
  });

  it("resets proxy token approval even when mint reverts (NEW-B)", async function () {
    const { owner, signer, its, token, adapter, tokenId, xrplAccount } = await deployFixture();

    // Deploy a market whose mint() can be toggled to revert
    const revertingMarket = await (
      await ethers.getContractFactory("MockCErc20MarketRevertingMint")
    ).deploy(token.target);
    await adapter.connect(owner).setMarket(revertingMarket.target, token.target, tokenId, true);

    const freshAccount = ethers.encodeBytes32String("dave");
    await adapter.connect(owner).setIntentSigner(freshAccount, signer.address);

    const supplyIntent = {
      intentId: randomIntentId("supply-revert-mint"),
      xrplAccount: freshAccount,
      market: revertingMarket.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 3_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    // Fund the adapter so it can forward tokens to the proxy
    await token.mint(adapter.target, 10_000n);
    await token.mint(revertingMarket.target, 10_000n);

    // First supply with mint succeeding — establishes the proxy address
    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await adapter
      .connect(await ethers.getImpersonatedSigner(its.target as string))
      .executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        encodeSignedIntent(await signIntent(adapter.target as string, signer, supplyIntent)),
        tokenId,
        token.target,
        supplyIntent.amount
      );

    // Now make mint revert and attempt a second supply
    await revertingMarket.setMintReverts(true);

    const supplyIntent2 = { ...supplyIntent, intentId: randomIntentId("supply-revert-mint-2"), nonce: 1 };
    await token.mint(adapter.target, 10_000n);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          encodeSignedIntent(await signIntent(adapter.target as string, signer, supplyIntent2)),
          tokenId,
          token.target,
          supplyIntent2.amount
        )
    ).to.be.reverted;

    // Verify: the proxy's allowance for the market has been reset to 0 even though mint reverted
    const { XRPLUserProxy } = await import("../../typechain-types");
    const proxyAddr = await (
      await ethers.getContractAt("XRPLUserProxyFactory", await adapter.proxyFactory())
    ).proxyOf(freshAccount);

    // Allowance should be 0 — not stuck at the pre-mint approval amount
    expect(await token.allowance(proxyAddr, revertingMarket.target)).to.equal(0);
  });

  it("supports repay-all via the type(uint256).max sentinel, clearing accrued-interest dust", async function () {
    const { signer, its, token, market, factory, adapter, tokenId, xrplAccount } = await deployFixture();

    // Establish the proxy with a small supply, then simulate a borrow whose debt has since accrued
    // interest beyond what the client could have known when it signed the intent.
    const supplyIntent = {
      intentId: randomIntentId("repay-all-setup"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };
    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await adapter
      .connect(await ethers.getImpersonatedSigner(its.target as string))
      .executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        encodeSignedIntent(await signIntent(adapter.target as string, signer, supplyIntent)),
        tokenId,
        token.target,
        supplyIntent.amount
      );

    const proxyAddress = await factory.proxyOf(xrplAccount);
    // Principal was 10_000; 5 units of interest accrued between signing and execution.
    await market.setBorrowBalance(proxyAddress, 10_005n);

    const repayAllIntent = {
      intentId: randomIntentId("repay-all"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.REPAY,
      amount: ethers.MaxUint256,
      nonce: 1,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          encodeSignedIntent(await signIntent(adapter.target as string, signer, repayAllIntent)),
          tokenId,
          token.target,
          10_005n // actual bridged amount: the live debt the client queried before sending
        )
    ).to.emit(adapter, "IntentExecuted");

    // Debt is fully cleared — no dust left behind.
    expect(await market.borrowBalanceOf(proxyAddress)).to.equal(0n);
    // Proxy allowance to the market was reset after repay.
    expect(await token.allowance(proxyAddress, market.target)).to.equal(0n);
  });

  it("rejects repay-all when the bridged token amount cannot cover the live debt", async function () {
    const { signer, its, token, market, factory, adapter, tokenId, xrplAccount } = await deployFixture();

    const supplyIntent = {
      intentId: randomIntentId("repay-all-underfunded-setup"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };
    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await adapter
      .connect(await ethers.getImpersonatedSigner(its.target as string))
      .executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        encodeSignedIntent(await signIntent(adapter.target as string, signer, supplyIntent)),
        tokenId,
        token.target,
        supplyIntent.amount
      );

    const proxyAddress = await factory.proxyOf(xrplAccount);
    await market.setBorrowBalance(proxyAddress, 10_005n);

    const repayAllIntent = {
      intentId: randomIntentId("repay-all-underfunded"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.REPAY,
      amount: ethers.MaxUint256,
      nonce: 1,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    // Client under-sent relative to the live debt — the adapter must not reach into its general
    // balance to make up the difference; the whole call should revert instead.
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          encodeSignedIntent(await signIntent(adapter.target as string, signer, repayAllIntent)),
          tokenId,
          token.target,
          9_000n
        )
    ).to.be.reverted;
  });

  it("still enforces the exact amount match for ordinary (non-sentinel) repay", async function () {
    const { signer, its, token, market, tokenId, adapter, xrplAccount } = await deployFixture();

    const repayIntent = {
      intentId: randomIntentId("repay-exact-mismatch"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.REPAY,
      amount: 4_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };

    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(its.target as string))
        .executeWithInterchainToken(
          ethers.ZeroHash,
          "xrpl-ledger",
          ethers.toUtf8Bytes("source-app"),
          encodeSignedIntent(await signIntent(adapter.target as string, signer, repayIntent)),
          tokenId,
          token.target,
          4_001n
        )
    ).to.be.revertedWithCustomError(adapter, "AmountMismatch");
  });

  it("supports withdraw-all via the amount == 0 sentinel, redeeming the full cToken balance", async function () {
    const { signer, gateway, its, token, market, factory, adapter, tokenId, xrplAccount } = await deployFixture();

    await ethers.provider.send("hardhat_setBalance", [adapter.target, "0x2386F26FC10000"]);
    await ethers.provider.send("hardhat_setBalance", [gateway.target, "0x1000000000000000000"]);

    // Establish the proxy via a supply, then simulate holding cTokens whose underlying value (at the
    // current exchange rate) has grown past what the client could have encoded when signing.
    const supplyIntent = {
      intentId: randomIntentId("withdraw-all-setup"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.SUPPLY,
      amount: 1_000n,
      nonce: 0,
      deadline: 0,
      destinationAddress: "0x",
      version: 1
    };
    await ethers.provider.send("hardhat_setBalance", [its.target, "0x1000000000000000000"]);
    await adapter
      .connect(await ethers.getImpersonatedSigner(its.target as string))
      .executeWithInterchainToken(
        ethers.ZeroHash,
        "xrpl-ledger",
        ethers.toUtf8Bytes("source-app"),
        encodeSignedIntent(await signIntent(adapter.target as string, signer, supplyIntent)),
        tokenId,
        token.target,
        supplyIntent.amount
      );

    const proxyAddress = await factory.proxyOf(xrplAccount);
    // The market must hold enough underlying to cover the redemption below.
    await token.mint(market.target, 20_000_000n);
    await market.setCTokenBalance(proxyAddress, 10_000_000n);
    await market.setExchangeRateMantissa(ethers.parseUnits("1.0001", 18)); // exchange rate drifted up since signing

    const withdrawAllIntent = {
      intentId: randomIntentId("withdraw-all"),
      xrplAccount,
      market: market.target as string,
      underlying: token.target as string,
      actionType: ActionType.WITHDRAW,
      amount: 0n, // WITHDRAW_ALL sentinel
      nonce: 1,
      deadline: 0,
      destinationAddress: ethers.hexlify(ethers.toUtf8Bytes("rDestination")),
      version: 1
    };

    await expect(
      adapter
        .connect(await ethers.getImpersonatedSigner(gateway.target as string))
        .execute(
          ethers.ZeroHash,
          "xrpl-ledger",
          "source-app",
          encodeSignedIntent(await signIntent(adapter.target as string, signer, withdrawAllIntent))
        )
    )
      .to.emit(adapter, "IntentExecuted")
      .and.to.emit(adapter, "EgressInitiated");

    // All cTokens were redeemed — no dust left in the proxy.
    expect(await market.balanceOf(proxyAddress)).to.equal(0n);

    // The bridged-out amount is the actual redeemed underlying (10_000_000 * 1.0001), not the
    // literal 0 sentinel that was signed in the intent.
    const expectedRedeemed = (10_000_000n * ethers.parseUnits("1.0001", 18)) / 10n ** 18n;
    const transfer = await its.lastTransfer();
    expect(transfer.amount).to.equal(expectedRedeemed);
    expect(expectedRedeemed).to.not.equal(10_000_000n);
  });
});
