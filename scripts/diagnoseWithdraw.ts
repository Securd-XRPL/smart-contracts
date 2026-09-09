import { ethers } from "hardhat";

const ADAPTER  = "0x7AC8Df85448037c6fE1eD5732c6ca71060069237";
const FACTORY  = "0x3C03CF51E4BFa50B5482165Cc053D71698b780f4";
const XRPL_ACC = "0x2ea412f6ebc3dd205acb240f955020d65ebc4af419ec5ed58726eafb38b56811";
const ACTION   = ["SUPPLY","BORROW","REPAY","WITHDRAW","ENTER_MARKET","EXIT_MARKET"];

const ABI = [
  "event IntentExecuted(bytes32 indexed intentId, bytes32 indexed xrplAccount, address indexed proxy, uint8 actionType, address market, address underlying, uint256 amount, bool tokenFlow)",
];
const FACTORY_ABI = ["function proxyOf(bytes32) view returns (address)"];
const CTOKEN_ABI  = ["function balanceOf(address) view returns (uint256)", "function exchangeRateStored() view returns (uint256)"];
const CXRP = "0x6ec503Ad093B8b8B74AD9168Acb3f547C79f0318";

async function main() {
  const provider = ethers.provider;
  const adapter  = new ethers.Contract(ADAPTER, ABI, provider);
  const factory  = new ethers.Contract(FACTORY, FACTORY_ABI, provider);

  const events = await adapter.queryFilter(adapter.filters.IntentExecuted(null, XRPL_ACC), 6994580, 6994590);

  console.log("\n══ SUPPLY event at block 6994584 ══");
  for (const e of events) {
    const proxyFromEvent   = e.args.proxy;
    const proxyFromFactory = await factory.proxyOf(XRPL_ACC);
    const cToken = new ethers.Contract(CXRP, CTOKEN_ABI, provider);
    const [cBal, exchRate] = await Promise.all([cToken.balanceOf(proxyFromEvent), cToken.exchangeRateStored()]);
    const underlying = (cBal * exchRate) / ethers.parseEther("1");
    const proxyNative = await provider.getBalance(proxyFromEvent);

    console.log("  tx            :", e.transactionHash);
    console.log("  proxy (event) :", proxyFromEvent);
    console.log("  proxyOf()     :", proxyFromFactory === ethers.ZeroAddress ? "ZERO — factory mapping mismatch!" : proxyFromFactory);
    console.log("  action        :", ACTION[Number(e.args.actionType)]);
    console.log("  amount        :", ethers.formatEther(e.args.amount), "XRP");
    console.log("  cXRP balance  :", cBal.toString());
    console.log("  underlying    :", ethers.formatEther(underlying), "XRP");
    console.log("  proxy native  :", ethers.formatEther(proxyNative), "XRP");
  }

  const adapterBal = await provider.getBalance(ADAPTER);
  console.log("\n  Adapter native XRP balance:", ethers.formatEther(adapterBal), "XRP");

  console.log("\n══ WITHDRAW failure analysis ══");
  console.log("  WITHDRAW payloadHashByIntent: EMPTY → tx reverted entirely, nonce stayed at 1");
  console.log("  Root cause: native XRP egress bug in _egress()");
  console.log("    1. redeemUnderlying(10 XRP) succeeds — cTokens redeemed, 10 XRP lands in proxy");
  console.log("    2. _proxyTokenCall(proxy, 0xEeee..., transfer_data) — calls address with no code");
  console.log("       returns (true,'') silently — XRP stays in proxy, adapter receives nothing");
  console.log("    3. interchainTransfer{value: egressGasValue=1 XRP}(tokenId, chain, dest, 10 XRP, ...)");
  console.log("       ITS expects msg.value >= amount (10 XRP) but only gets 1 XRP → REVERTS");
  console.log("    4. Entire WITHDRAW transaction reverts — cTokens restored, nonce unchanged");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
