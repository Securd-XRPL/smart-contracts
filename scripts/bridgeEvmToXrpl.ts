/**
 * Bridges an ITS ERC-20 token from XRPL EVM → XRPL Ledger via Axelar ITS.
 *
 * Flow:
 *   1. Approve ITS to spend the ERC-20 token
 *   2. Call ITS.interchainTransfer() with native XRP as Axelar gas
 *   3. Axelar relayer delivers the IOU to the XRPL Ledger wallet
 *
 * Required env vars:
 *   XRPL_EVM_RPC_URL             XRPL EVM RPC endpoint
 *   DEPLOYER_PRIVATE_KEY         Sender private key on XRPL EVM
 *   INTERCHAIN_TOKEN_SERVICE     ITS contract address
 *   BRIDGE_TOKEN_ADDRESS         ERC-20 token address on XRPL EVM
 *   BRIDGE_TOKEN_ID              ITS tokenId (bytes32)
 *   BRIDGE_AMOUNT                Amount to send in whole tokens (e.g. "5000")
 *   BRIDGE_DESTINATION_XRPL     Destination XRPL r-address
 *
 * Optional env vars:
 *   BRIDGE_DESTINATION_CHAIN     default: xrpl
 *   BRIDGE_EGRESS_GAS_VALUE      Axelar gas in wei (default: 2000000000000000000 = 2 XRP)
 *   XRPL_CONFIRM_SEND            Set to "true" to actually submit (default: dry-run)
 */
import { ethers } from "ethers";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const ITS_ABI = [
  "function interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue) payable",
];

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

async function main() {
  const evmRpcUrl         = requiredEnv("XRPL_EVM_RPC_URL");
  const privateKey        = requiredEnv("DEPLOYER_PRIVATE_KEY");
  const itsAddress        = optionalEnv("INTERCHAIN_TOKEN_SERVICE", "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C");
  const tokenAddress      = requiredEnv("BRIDGE_TOKEN_ADDRESS");
  const tokenId           = requiredEnv("BRIDGE_TOKEN_ID");
  const amountWhole       = requiredEnv("BRIDGE_AMOUNT");
  const destinationXrpl   = requiredEnv("BRIDGE_DESTINATION_XRPL");
  const destinationChain  = optionalEnv("BRIDGE_DESTINATION_CHAIN", "xrpl");
  const gasValueStr       = optionalEnv("BRIDGE_EGRESS_GAS_VALUE", "2000000000000000000"); // 2 XRP
  const confirmSend       = process.env.XRPL_CONFIRM_SEND === "true";

  const provider  = new ethers.JsonRpcProvider(evmRpcUrl);
  const signer    = new ethers.Wallet(privateKey, provider);
  const token     = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const its       = new ethers.Contract(itsAddress, ITS_ABI, signer);

  const [decimals, symbol, balance] = await Promise.all([
    token.decimals(),
    token.symbol(),
    token.balanceOf(signer.address),
  ]);

  const amount     = ethers.parseUnits(amountWhole, decimals);
  const gasValue   = BigInt(gasValueStr);
  const destBytes  = ethers.toUtf8Bytes(destinationXrpl);

  console.log(JSON.stringify({
    dryRun:           !confirmSend,
    sender:           signer.address,
    token:            tokenAddress,
    symbol,
    decimals:         Number(decimals),
    balance:          ethers.formatUnits(balance, decimals),
    amount:           ethers.formatUnits(amount, decimals),
    amountRaw:        amount.toString(),
    tokenId,
    destinationChain,
    destinationXrpl,
    gasValue:         ethers.formatEther(gasValue.toString()) + " XRP",
  }, null, 2));

  if (balance < amount) {
    throw new Error(`Insufficient balance: have ${ethers.formatUnits(balance, decimals)}, need ${amountWhole}`);
  }

  if (!confirmSend) {
    console.log("\nSet XRPL_CONFIRM_SEND=true to submit.");
    return;
  }

  // Step 1: approve ITS
  console.log("\nApproving ITS...");
  const approveTx = await token.approve(itsAddress, amount);
  await approveTx.wait();
  console.log("Approved. TX:", approveTx.hash);

  // Step 2: interchainTransfer
  console.log("Calling interchainTransfer...");
  const bridgeTx = await its.interchainTransfer(
    tokenId,
    destinationChain,
    destBytes,
    amount,
    "0x",          // no metadata
    gasValue,
    { value: gasValue }
  );
  const receipt = await bridgeTx.wait();
  console.log("Bridge TX:", bridgeTx.hash);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log(`\nAxelarscan: https://testnet.axelarscan.io/gmp/${bridgeTx.hash}`);
  console.log(`Wait ~30-60 s for the IOU to arrive at ${destinationXrpl} on XRPL Ledger.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
