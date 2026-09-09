import { ethers } from "hardhat";
async function main() {
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  console.log("Deployer :", signer.address);
  console.log("Balance  :", ethers.formatEther(bal), "XRP");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
