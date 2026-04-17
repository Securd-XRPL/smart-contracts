import { ethers } from "hardhat";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main() {
  const unitrollerAddress = requiredEnv("UNITROLLER_ADDRESS");
  const [signer] = await ethers.getSigners();
  const unitroller = await ethers.getContractAt("Unitroller", unitrollerAddress);

  const pendingAdmin = await unitroller.pendingAdmin();
  console.log(`Signer: ${signer.address}`);
  console.log(`Unitroller: ${unitrollerAddress}`);
  console.log(`Pending admin: ${pendingAdmin}`);

  if (pendingAdmin.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Signer is not the pending admin for this Unitroller");
  }

  const tx = await unitroller._acceptAdmin();
  await tx.wait();

  console.log("Unitroller admin accepted successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
