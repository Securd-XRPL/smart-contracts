/**
 * Polls XrplEvmDemoReceiver on XRPL EVM testnet and prints the last received GMP message
 * and ITS transfer. Run this after submitting a transaction to verify Axelar delivery.
 *
 * Required env vars:
 *   XRPL_EVM_RPC_URL         e.g. https://rpc.testnet.xrplevm.org
 *   XRPL_EVM_DEMO_RECEIVER   XrplEvmDemoReceiver address on XRPL EVM
 *
 * Run:
 *   ts-node scripts/checkXrplEvmDemoReceiver.ts
 */
import { ethers } from "ethers";

const ABI = [
  "function totalGmpMessages() view returns (uint256)",
  "function totalItsTransfers() view returns (uint256)",
  "function lastGmpMessage() view returns (tuple(bytes32 commandId, string sourceChain, string sourceAddress, string sender, string message, uint256 xrpDrops, uint256 receivedAt))",
  "function lastItsTransfer() view returns (tuple(bytes32 commandId, string sourceChain, bytes32 tokenId, address token, uint256 amount, string sender, string message, uint256 xrpDrops, uint256 receivedAt))"
];

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

async function main() {
  const rpcUrl = req("XRPL_EVM_RPC_URL");
  const receiverAddress = req("XRPL_EVM_DEMO_RECEIVER");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const receiver = new ethers.Contract(receiverAddress, ABI, provider);

  const network = await provider.getNetwork();
  console.log(`Network: chainId=${network.chainId}`);
  console.log(`Receiver: ${receiverAddress}\n`);

  const totalGmp = await receiver.totalGmpMessages();
  const totalIts = await receiver.totalItsTransfers();
  console.log(`Total GMP messages received : ${totalGmp}`);
  console.log(`Total ITS transfers received: ${totalIts}\n`);

  if (totalGmp > 0n) {
    const msg = await receiver.lastGmpMessage();
    console.log("=== Last GMP Message ===");
    console.log({
      commandId: msg.commandId,
      sourceChain: msg.sourceChain,
      sourceAddress: msg.sourceAddress,
      sender: msg.sender,
      message: msg.message,
      xrpDrops: msg.xrpDrops.toString(),
      receivedAt: new Date(Number(msg.receivedAt) * 1000).toISOString()
    });
  } else {
    console.log("No GMP messages received yet.");
  }

  console.log();

  if (totalIts > 0n) {
    const transfer = await receiver.lastItsTransfer();
    console.log("=== Last ITS Transfer ===");
    console.log({
      commandId: transfer.commandId,
      sourceChain: transfer.sourceChain,
      tokenId: transfer.tokenId,
      token: transfer.token,
      amount: transfer.amount.toString(),
      sender: transfer.sender,
      message: transfer.message,
      xrpDrops: transfer.xrpDrops.toString(),
      receivedAt: new Date(Number(transfer.receivedAt) * 1000).toISOString()
    });
  } else {
    console.log("No ITS transfers received yet.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
