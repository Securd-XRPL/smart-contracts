import { ethers } from "hardhat";

const XRPL_ADDRESS = "r4obbPExFxVcmqUBr5jepsdtDLX3htdq48";
const ADAPTER_ABI = [
  "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
];

async function main() {
  const provider = ethers.provider;
  const adapterAddr = process.env.XRPL_BRIDGE_ADAPTER!;
  const adapter = new ethers.Contract(adapterAddr, ADAPTER_ABI, provider);
  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(XRPL_ADDRESS));
  const nonce = await adapter.nextNonceByXrplAccount(xrplAccount);
  console.log("Current nonce:", nonce.toString());
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
