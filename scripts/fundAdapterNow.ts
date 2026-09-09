import { ethers } from "hardhat";

const ADAPTER = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const AMOUNT  = ethers.parseEther("30");

async function main() {
  const [signer] = await ethers.getSigners();

  const before = await ethers.provider.getBalance(ADAPTER);
  console.log("Adapter before:", ethers.formatEther(before), "XRP");

  const tx = await signer.sendTransaction({ to: ADAPTER, value: AMOUNT });
  await tx.wait();
  console.log("TX:", tx.hash);

  const after = await ethers.provider.getBalance(ADAPTER);
  console.log("Adapter after :", ethers.formatEther(after), "XRP");
  console.log("Ops available :", after / ethers.parseEther("1"), "(at 1 XRP/op)");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
