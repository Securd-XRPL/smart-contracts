/**
 * Prints supplied and borrowed balances for all known accounts
 * across sXRP and sSTST markets.
 *
 * Required env vars: XRPL_EVM_RPC_URL
 */
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOYMENT_FILE = "deployments/xrpl-evm-testnet.json";

// All known participant addresses (deployer, proxies, direct EVM testers)
const KNOWN_ACCOUNTS = [
  "0x243CD17C18052dD49B803dB5be3c2907DA6ff783", // deployer / direct EVM tester
  "0x4409B6F95DbE77398cE9D4B7FA1E146bfE5B5e86", // XRPL user proxy (r4obbPExFxVcmqUBr5jepsdtDLX3htdq48)
];

const PROXY_FACTORY_ABI = [
  "function proxyCount() view returns (uint256)",
  "function proxyAtIndex(uint256) view returns (address)",
];

const ADAPTER_ABI = [
  "function xrplUserProxyFactory() view returns (address)",
];

const CTOKEN_ABI = [
  "function balanceOfUnderlying(address account) returns (uint256)",
  "function borrowBalanceCurrent(address account) returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function symbol() view returns (string)",
];

async function main() {
  const dep      = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const provider = ethers.provider;

  // Discover all deployed proxies from the factory
  const adapter = new ethers.Contract(dep.xrplBridgeAdapter, ADAPTER_ABI, provider);
  let factoryAddr: string;
  try {
    factoryAddr = dep.xrplUserProxyFactory;
  } catch {
    factoryAddr = "";
  }

  const accounts = new Set<string>(KNOWN_ACCOUNTS.map(a => a.toLowerCase()));

  if (factoryAddr && factoryAddr !== ethers.ZeroAddress) {
    const factory = new ethers.Contract(factoryAddr, PROXY_FACTORY_ABI, provider);
    try {
      const count = Number(await factory.proxyCount());
      for (let i = 0; i < count; i++) {
        const proxy = await factory.proxyAtIndex(i);
        accounts.add(proxy.toLowerCase());
      }
    } catch {
      // factory ABI may differ — use known list
    }
  }

  const allAccounts = Array.from(accounts);

  for (const market of dep.markets) {
    const cToken = new ethers.Contract(market.cToken, CTOKEN_ABI, provider);
    const [totalBorrows, cash] = await Promise.all([
      cToken.totalBorrows(),
      cToken.getCash(),
    ]);

    console.log(`\n${"═".repeat(62)}`);
    console.log(` ${market.cTokenSymbol}  ${market.cToken}`);
    console.log(`${"═".repeat(62)}`);
    console.log(` Protocol totals:`);
    console.log(`   Cash (liquidity) : ${ethers.formatEther(cash)}`);
    console.log(`   Total Borrowed   : ${ethers.formatEther(totalBorrows)}`);
    console.log(`\n Per-account positions:`);

    let sumSupplied = 0n;
    let sumBorrowed = 0n;

    for (const addr of allAccounts) {
      try {
        const [supplied, borrowed] = await Promise.all([
          cToken.balanceOfUnderlying.staticCall(addr),
          cToken.borrowBalanceCurrent.staticCall(addr),
        ]);
        if (supplied === 0n && borrowed === 0n) continue;
        console.log(`\n   ${addr}`);
        console.log(`     Supplied : ${ethers.formatEther(supplied)} ${market.cTokenSymbol.slice(1)}`);
        console.log(`     Borrowed : ${ethers.formatEther(borrowed)} ${market.cTokenSymbol.slice(1)}`);
        sumSupplied += supplied;
        sumBorrowed += borrowed;
      } catch {
        // skip accounts that revert (e.g. address has no interaction)
      }
    }

    if (sumSupplied === 0n && sumBorrowed === 0n) {
      console.log("   (no non-zero positions found)");
    } else {
      console.log(`\n ── Aggregate ──`);
      console.log(`   Total Supplied : ${ethers.formatEther(sumSupplied)} ${market.cTokenSymbol.slice(1)}`);
      console.log(`   Total Borrowed : ${ethers.formatEther(sumBorrowed)} ${market.cTokenSymbol.slice(1)}`);
    }
  }
  console.log();
}

main().catch(err => { console.error(err); process.exitCode = 1; });
