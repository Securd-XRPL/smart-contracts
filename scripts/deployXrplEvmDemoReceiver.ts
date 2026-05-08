/**
 * Deploys XrplEvmDemoReceiver to XRPL EVM testnet and configures trusted sources.
 *
 * Required env vars:
 *   XRPL_EVM_RPC_URL          e.g. https://rpc.testnet.xrplevm.org
 *   DEPLOYER_PRIVATE_KEY      EVM private key with testnet XRP for gas
 *
 * Optional env vars:
 *   DEPLOY_OWNER              Final owner address (defaults to deployer)
 *   AXELAR_GATEWAY            Axelar gateway on XRPL EVM (default: live testnet)
 *   INTERCHAIN_TOKEN_SERVICE  Axelar ITS on XRPL EVM (default: live testnet)
 *   XRPL_GMP_SOURCE_CHAIN     Axelar chain name for XRPL Ledger (default: xrpl)
 *   XRPL_GMP_SOURCE_ADDRESS   XRPL Ledger source contract address as string (optional)
 *   XRPL_ITS_SOURCE_CHAIN     Axelar chain name for XRPL ITS (default: xrpl)
 *   XRPL_ITS_SOURCE_ADDRESS   XRPL Ledger ITS source address as UTF-8/hex bytes (optional)
 *
 * Run:
 *   npx hardhat run scripts/deployXrplEvmDemoReceiver.ts --network xrplEvm
 */
import { ethers } from "hardhat";

const LIVE_AXELAR_GATEWAY = "0xe432150cce91c13a887f7D836923d5597adD8E31";
const LIVE_ITS = "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C";

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = opt("DEPLOY_OWNER", deployer.address);
  const gateway = opt("AXELAR_GATEWAY", LIVE_AXELAR_GATEWAY);
  const its = opt("INTERCHAIN_TOKEN_SERVICE", LIVE_ITS);

  console.log(`Deployer : ${deployer.address}`);
  console.log(`Owner    : ${owner}`);
  console.log(`Gateway  : ${gateway}`);
  console.log(`ITS      : ${its}`);

  const Factory = await ethers.getContractFactory("XrplEvmDemoReceiver");
  const receiver = await Factory.deploy(deployer.address, gateway, its);
  await receiver.waitForDeployment();
  const receiverAddr = await receiver.getAddress();
  console.log(`\nXrplEvmDemoReceiver deployed: ${receiverAddr}`);

  // Trust XRPL Ledger GMP source if configured
  const gmpChain = opt("XRPL_GMP_SOURCE_CHAIN", "xrpl");
  const gmpSourceAddr = process.env.XRPL_GMP_SOURCE_ADDRESS?.trim();
  if (gmpSourceAddr) {
    await (await receiver.setTrustedGmpSource(gmpChain, gmpSourceAddr, true)).wait();
    console.log(`Trusted GMP source: chain=${gmpChain} address=${gmpSourceAddr}`);
  } else {
    console.log("Skipping GMP source trust — set XRPL_GMP_SOURCE_ADDRESS to enable");
  }

  // Trust XRPL Ledger ITS source if configured
  const itsChain = opt("XRPL_ITS_SOURCE_CHAIN", "xrpl");
  const itsSourceAddrRaw = process.env.XRPL_ITS_SOURCE_ADDRESS?.trim();
  if (itsSourceAddrRaw) {
    const itsSourceBytes = itsSourceAddrRaw.startsWith("0x")
      ? itsSourceAddrRaw
      : ethers.hexlify(ethers.toUtf8Bytes(itsSourceAddrRaw));
    await (await receiver.setTrustedItsSource(itsChain, itsSourceBytes, true)).wait();
    console.log(`Trusted ITS source: chain=${itsChain} address=${itsSourceAddrRaw}`);
  } else {
    console.log("Skipping ITS source trust — set XRPL_ITS_SOURCE_ADDRESS to enable");
  }

  // Transfer ownership if needed
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await receiver.transferOwnership(owner)).wait();
    console.log(`Ownership transferred to ${owner}`);
  }

  console.log("\n=== Deployment complete ===");
  console.log(JSON.stringify({
    network: "xrpl-evm-testnet",
    receiver: receiverAddr,
    gateway,
    its,
    owner,
    deployer: deployer.address
  }, null, 2));

  console.log("\nNext steps:");
  console.log(`  1. Copy receiver address: ${receiverAddr}`);
  console.log(`  2. Set XRPL_EVM_DEMO_RECEIVER=${receiverAddr} in your .env`);
  console.log(`  3. Run: ts-node scripts/sendXrplGmpMessage.ts      (pure GMP message)`);
  console.log(`  4. Run: ts-node scripts/sendXrplItsWithGmp.ts      (XRP transfer + GMP payload)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
