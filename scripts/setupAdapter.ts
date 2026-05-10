/**
 * Post-deployment setup: registers the intent signer for the XRPL test wallet
 * and posts the initial fallback XRP price so the oracle can serve prices.
 *
 * Run with: hardhat run scripts/setupAdapter.ts --network xrplEvm
 */
import { ethers } from "hardhat";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Setup signer: ${signer.address}`);

  const adapterAddress = requiredEnv("XRPL_BRIDGE_ADAPTER");
  const oracleAddress = requiredEnv("XRPL_ORACLE_ADDRESS");
  const underlying = requiredEnv("XRPL_DEPOSIT_UNDERLYING");
  const xrplWalletAddress = requiredEnv("XRPL_WALLET_ADDRESS");

  // keccak256(toUtf8Bytes(xrplWallet.address)) — matches submitXrplDeposit.ts encoding
  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplWalletAddress));
  console.log(`XRPL account key: ${xrplAccount}`);

  const adapterAbi = [
    "function setIntentSigner(bytes32 xrplAccount, address signer) external",
    "function intentSignerOfXrplAccount(bytes32 xrplAccount) view returns (address)"
  ];
  const oracleAbi = [
    "function postFallbackPrice(address asset, uint256 priceMantissa) external",
    "function setFallbackConfig(address asset, uint256 maxDelaySeconds) external"
  ];

  const adapter = new ethers.Contract(adapterAddress, adapterAbi, signer);
  const oracle = new ethers.Contract(oracleAddress, oracleAbi, signer);

  // Register signer
  const currentSigner = await adapter.intentSignerOfXrplAccount(xrplAccount);
  if (currentSigner.toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`Registering intent signer ${signer.address} for XRPL account ${xrplWalletAddress}...`);
    const tx = await adapter.setIntentSigner(xrplAccount, signer.address);
    await tx.wait();
    console.log(`Intent signer set. TX: ${tx.hash}`);
  } else {
    console.log(`Intent signer already set to ${signer.address}`);
  }

  // Post initial XRP fallback price: $2.50 = 2.5e18
  console.log("Setting fallback oracle config for XRP...");
  const configTx = await oracle.setFallbackConfig(underlying, 86400);
  await configTx.wait();
  console.log(`Oracle fallback config set. TX: ${configTx.hash}`);

  const priceMantissa = ethers.parseEther("2.5");
  console.log(`Posting fallback XRP price: $2.50 (${priceMantissa})...`);
  const priceTx = await oracle.postFallbackPrice(underlying, priceMantissa);
  await priceTx.wait();
  console.log(`Fallback price posted. TX: ${priceTx.hash}`);

  console.log("\nSetup complete.");
}

main().catch((err) => { console.error(err); process.exit(1); });
