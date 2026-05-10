import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const adapterAddress = process.env.XRPL_BRIDGE_ADAPTER!;

  const balanceBefore = await ethers.provider.getBalance(adapterAddress);
  console.log(`Adapter XRP before: ${ethers.formatEther(balanceBefore)} XRP`);

  const tx = await signer.sendTransaction({
    to: adapterAddress,
    value: ethers.parseEther("5")
  });
  await tx.wait();
  console.log(`Funded. TX: ${tx.hash}`);

  const balanceAfter = await ethers.provider.getBalance(adapterAddress);
  console.log(`Adapter XRP after:  ${ethers.formatEther(balanceAfter)} XRP`);
}

main().catch((e) => { console.error(e); process.exit(1); });
