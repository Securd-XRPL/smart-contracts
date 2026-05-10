import { ethers } from "hardhat";

async function main() {
  const provider = ethers.provider;
  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes("r4obbPExFxVcmqUBr5jepsdtDLX3htdq48"));

  const adapterAbi = [
    "function nextNonceByXrplAccount(bytes32) view returns (uint64)",
    "function proxyFactory() view returns (address)"
  ];
  const factoryAbi = [
    "function proxyOf(bytes32) view returns (address)",
    "function proxyCount() view returns (uint256)"
  ];
  const cTokenAbi = [
    "function getAccountSnapshot(address) view returns (uint256,uint256,uint256,uint256)",
    "function totalBorrows() view returns (uint256)"
  ];

  const adapter = new ethers.Contract(process.env.XRPL_BRIDGE_ADAPTER!, adapterAbi, provider);
  const nonce = await adapter.nextNonceByXrplAccount(xrplAccount);
  const factoryAddr = await adapter.proxyFactory();
  const factory = new ethers.Contract(factoryAddr, factoryAbi, provider);
  const proxyCount = await factory.proxyCount();
  const proxyAddr = await factory.proxyOf(xrplAccount);

  console.log("Nonce:", nonce.toString());
  console.log("Proxy count:", proxyCount.toString());
  console.log("Proxy:", proxyAddr);

  if (proxyAddr !== ethers.ZeroAddress) {
    const cToken = new ethers.Contract(process.env.XRPL_DEPOSIT_MARKET!, cTokenAbi, provider);
    const [err, cTokenBal, borrowBal, exchangeRate] = await cToken.getAccountSnapshot(proxyAddr);
    const proxyBalance = await provider.getBalance(proxyAddr);
    const adapterBalance = await provider.getBalance(process.env.XRPL_BRIDGE_ADAPTER!);
    console.log("sXRP balance:", cTokenBal.toString());
    console.log("Borrow balance:", borrowBal.toString());
    console.log("Proxy native XRP:", ethers.formatEther(proxyBalance));
    console.log("Adapter native XRP:", ethers.formatEther(adapterBalance));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
