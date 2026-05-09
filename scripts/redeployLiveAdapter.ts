import { ethers } from 'hardhat';

const EXPECTED_CHAIN_ID = 1440002; // XRPL EVM testnet

function requiredEnvAddr(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  if (!ethers.isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`);
  return v;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== BigInt(EXPECTED_CHAIN_ID)) {
    throw new Error(`Wrong network: expected chainId ${EXPECTED_CHAIN_ID}, got ${network.chainId}`);
  }

  const owner = process.env.DEPLOY_OWNER?.trim() || deployer.address;
  if (!ethers.isAddress(owner)) throw new Error(`DEPLOY_OWNER is not a valid address: ${owner}`);

  const gateway = '0xe432150cce91c13a887f7D836923d5597adD8E31';
  const its = '0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C';
  const proxyFactoryAddr = '0x3C03CF51E4BFa50B5482165Cc053D71698b780f4';
  const destinationChain = 'xrpl';
  const xrplAddress = 'rJ6ttDMpZtDrdLsgoJuCTbtBTgth9JkyHa';
  const xrplAccount = ethers.keccak256(ethers.toUtf8Bytes(xrplAddress));
  const market = '0x1F5e22531E3Fe61614fF96B06b8A4567B83A8bAD';
  // NOTE: '0xEeee...' is the native-token sentinel — replace with the actual ERC20 address for this market.
  const underlying = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
  const tokenId = '0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f';

  // Pre-flight: XRPLUserProxyFactory freezes setController after the first proxy is created.
  // If proxyCount > 0, calling setController reverts with ControllerFrozen, leaving the new
  // adapter orphaned and the protocol broken. A full factory migration is required in that case.
  const factory = await ethers.getContractAt('XRPLUserProxyFactory', proxyFactoryAddr);
  const proxyCount: bigint = await factory.proxyCount();
  if (proxyCount > 0n) {
    throw new Error(
      `Cannot repoint the existing factory: proxyCount=${proxyCount}. ` +
      'Deploy a new XRPLUserProxyFactory alongside the new adapter, ' +
      'migrate intent-signer registrations, and update the deployment config.'
    );
  }

  const Adapter = await ethers.getContractFactory('XRPLSecurdBridgeAdapter');
  const adapter = await Adapter.deploy(owner, gateway, its, proxyFactoryAddr, destinationChain);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();

  await (await factory.setController(adapterAddr)).wait();

  await (await adapter.setMarket(market, underlying, tokenId, true)).wait();
  await (await adapter.setTrustedItsSource('xrpl', ethers.toUtf8Bytes(xrplAddress), true)).wait();
  await (await adapter.setTrustedGmpSource('xrpl', xrplAddress, true)).wait();
  await (await adapter.setIntentSigner(xrplAccount, owner)).wait();

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`Transferring adapter ownership to: ${owner}`);
    await (await adapter.transferOwnership(owner)).wait();
  }

  console.log(JSON.stringify({
    deployer: deployer.address,
    owner,
    adapter: adapterAddr,
    gateway,
    its,
    proxyFactory: proxyFactoryAddr,
    market,
    underlying,
    tokenId,
    xrplAddress,
    xrplAccount
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
