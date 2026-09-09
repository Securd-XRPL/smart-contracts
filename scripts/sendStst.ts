import { Client, Wallet, Payment } from "xrpl";

const DESTINATION  = "rBSKvJNZWwLPUgHR17xjCSWSACQyCsFnCt";
const STST_ISSUER  = "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2";
const STST_HEX     = "5354535400000000000000000000000000000000";
const AMOUNT       = "1000";

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const seed   = requiredEnv("XRPL_SEED");
  const node   = process.env.XRPL_RPC_URL ?? "wss://s.altnet.rippletest.net:51233";

  const client = new Client(node);
  await client.connect();

  const wallet = Wallet.fromSeed(seed);
  console.log(`Sending from : ${wallet.address}`);
  console.log(`Sending to   : ${DESTINATION}`);
  console.log(`Amount       : ${AMOUNT} STST`);

  const tx: Payment = {
    TransactionType: "Payment",
    Account:         wallet.address,
    Destination:     DESTINATION,
    Amount: {
      currency: STST_HEX,
      issuer:   STST_ISSUER,
      value:    AMOUNT,
    },
  };

  const prepared = await client.autofill(tx);
  const signed   = wallet.sign(prepared);
  const result   = await client.submitAndWait(signed.tx_blob);

  const outcome = (result.result.meta as any).TransactionResult;
  console.log(`TX hash      : ${signed.hash}`);
  console.log(`Result       : ${outcome}`);

  if (outcome !== "tesSUCCESS") {
    console.error("FAILED:", JSON.stringify(result.result.meta, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`✓  ${AMOUNT} STST sent to ${DESTINATION}`);
  }

  await client.disconnect();
}

main().catch(e => { console.error(e); process.exitCode = 1; });
