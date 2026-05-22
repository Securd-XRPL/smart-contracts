/**
 * Lists all scripts in the scripts/ directory with their one-line description.
 * Run with: npx hardhat run scripts/listScripts.ts
 */
import fs from "fs";
import path from "path";

const SCRIPTS_DIR = path.join(__dirname);

// Category groupings
const CATEGORIES: Record<string, string[]> = {
  "🚀 Deployment": [
    "deploySecurdStack.ts",
    "deployStsTMarket.ts",
    "deployLiquidationKeeper.ts",
    "deployMedianOracleReporter.ts",
    "deployXrplEvmDemoReceiver.ts",
    "redeployLiveAdapter.ts",
  ],
  "⚙️  Setup & Configuration": [
    "setupAdapter.ts",
    "acceptUnitrollerAdmin.ts",
    "configureBandOracle.ts",
    "deployAndAssignSeparateIRMs.ts",
    "updateJumpRateModel.ts",
    "executeSetCollateralFactor.ts",
    "timelockSupportStsTMarket.ts",
    "fundAdapter.ts",
    "openXrplTrustline.ts",
  ],
  "📊 Read / Inspect": [
    "readMarket.ts",
    "checkState.ts",
    "checkIrm.ts",
    "checkNonce.ts",
    "checkAdapterEvents.ts",
    "checkAdapterFunds.ts",
    "checkXrpOraclePrice.ts",
    "checkAndRefreshOraclePrice.ts",
    "checkXrplEvmDemoReceiver.ts",
    "checkCoverage.ts",
    "smokeCheckDeployment.ts",
    "verifyDeployedSecurdStack.ts",
  ],
  "🔁 End-to-End Lending Flows": [
    "runXrplLendingFlow.ts",
    "runStsTXrplLendingFlow.ts",
    "testStsTLending.ts",
  ],
  "📤 Individual XRPL Transactions (XRP)": [
    "submitXrplDeposit.ts",
    "submitXrplEnterMarket.ts",
    "submitXrplBorrow.ts",
    "submitXrplRepay.ts",
    "submitXrplExitMarket.ts",
    "submitXrplWithdraw.ts",
  ],
  "📤 Individual XRPL Transactions (STST)": [
    "submitXrplStsTSupply.ts",
    "submitXrplStsTRepay.ts",
  ],
  "🌉 Bridge Utilities": [
    "bridgeEvmToXrpl.ts",
    "sendXrplGmpMessage.ts",
    "sendXrplItsWithGmp.ts",
  ],
  "🔮 Oracle": [
    "runXrplLpOracleBot.ts",
    "runXrplLpOracleAggregator.ts",
    "xrplLpOracleConfig.ts",
    "xrplLpOracleQuorum.ts",
  ],
  "📋 Manifests & Validation": [
    "deploymentManifest.ts",
    "signDeploymentManifest.ts",
    "verifyDeploymentManifest.ts",
    "validateDeploymentRecord.ts",
    "securdDeploymentConfig.ts",
    "validateSecurdDeploymentInputs.ts",
    "validateLiquidationBotConfig.ts",
    "validateXrplLpOracleConfig.ts",
    "liquidationBotConfig.ts",
  ],
};

// One-line description for each script
const DESCRIPTIONS: Record<string, string> = {
  // Deployment
  "deploySecurdStack.ts":          "Deploy the full Securd protocol stack (Comptroller, Oracle, cTokens, Adapter)",
  "deployStsTMarket.ts":           "Deploy the sSTST cToken market and register it in the Comptroller",
  "deployLiquidationKeeper.ts":    "Deploy the LiquidationKeeper contract for automated liquidations",
  "deployMedianOracleReporter.ts": "Deploy the MedianOracleReporter for LP price feeds",
  "deployXrplEvmDemoReceiver.ts":  "Deploy a demo GMP receiver contract on XRPL EVM",
  "redeployLiveAdapter.ts":        "Redeploy XRPLSecurdBridgeAdapter preserving existing market configs",

  // Setup & Configuration
  "setupAdapter.ts":               "Register intent signer and post initial fallback XRP price (post-deploy setup)",
  "acceptUnitrollerAdmin.ts":      "Accept pending admin on the Unitroller (completes 2-step admin transfer)",
  "configureBandOracle.ts":        "Set Band Protocol as price oracle for sXRP (XRP/USD) and sSTST (USDC/USD)",
  "deployAndAssignSeparateIRMs.ts":"Deploy separate JumpRateModel IRMs for sXRP and sSTST and assign them",
  "updateJumpRateModel.ts":        "Update the shared IRM parameters (base rate, multiplier, jump, kink)",
  "executeSetCollateralFactor.ts": "Set collateral factor for a market via the Comptroller admin",
  "timelockSupportStsTMarket.ts":  "Submit sSTST _supportMarket call through the Timelock",
  "fundAdapter.ts":                "Send XRP to the adapter to top up the egress gas balance",
  "openXrplTrustline.ts":          "Create a TrustSet on XRPL for the STST IOU (required before receiving STST)",

  // Read / Inspect
  "readMarket.ts":                 "Print full market snapshot: APY, TVL, borrows, utilization, oracle price",
  "checkState.ts":                 "Show supplied/borrowed balances for all known accounts across all markets",
  "checkIrm.ts":                   "Print IRM parameters and computed APYs for each market",
  "checkNonce.ts":                 "Read the current adapter nonce for the test XRPL account",
  "checkAdapterEvents.ts":         "Query IntentExecuted / EgressInitiated / DuplicateIgnored events from adapter",
  "checkAdapterFunds.ts":          "Check adapter native XRP balance vs egressGasValue and warn if low",
  "checkXrpOraclePrice.ts":        "Read the current XRP oracle price from the SecurdPriceOracle",
  "checkAndRefreshOraclePrice.ts": "Check the STST fallback price and repost it if stale or expired",
  "checkXrplEvmDemoReceiver.ts":   "Read messages received by the demo GMP receiver contract",
  "checkCoverage.ts":              "Check test coverage metrics",
  "smokeCheckDeployment.ts":       "Quick sanity check: verify key contracts respond on the target network",
  "verifyDeployedSecurdStack.ts":  "Deep verification of all deployed contract state and configuration",

  // End-to-End Lending Flows
  "runXrplLendingFlow.ts":         "Full 6-step XRP lending flow: SUPPLY → ENTER → BORROW → REPAY → EXIT → WITHDRAW",
  "runStsTXrplLendingFlow.ts":     "Full 6-step STST lending flow via Axelar ITS (same sequence with IOU token)",
  "testStsTLending.ts":            "Direct EVM test of sSTST market (no XRPL bridge, uses EVM signer)",

  // Individual XRPL Transactions (XRP)
  "submitXrplDeposit.ts":          "Submit a single SUPPLY intent for XRP via interchain_transfer",
  "submitXrplEnterMarket.ts":      "Submit a single ENTER_MARKET intent via call_contract",
  "submitXrplBorrow.ts":           "Submit a single BORROW intent via call_contract",
  "submitXrplRepay.ts":            "Submit a single REPAY intent for XRP via interchain_transfer",
  "submitXrplExitMarket.ts":       "Submit a single EXIT_MARKET intent via call_contract",
  "submitXrplWithdraw.ts":         "Submit a single WITHDRAW intent via call_contract",

  // Individual XRPL Transactions (STST)
  "submitXrplStsTSupply.ts":       "Submit a single SUPPLY intent for STST IOU via interchain_transfer",
  "submitXrplStsTRepay.ts":        "Submit a single REPAY intent for STST IOU via interchain_transfer",

  // Bridge Utilities
  "bridgeEvmToXrpl.ts":            "Bridge an ITS ERC-20 token from XRPL EVM back to XRPL Ledger",
  "sendXrplGmpMessage.ts":         "Send a raw GMP call_contract message from XRPL to XRPL EVM",
  "sendXrplItsWithGmp.ts":         "Send an ITS interchain_transfer with a GMP payload from XRPL",

  // Oracle
  "runXrplLpOracleBot.ts":         "Run the LP oracle bot: subscribe to XRPL DEX prices and push on-chain",
  "runXrplLpOracleAggregator.ts":  "Aggregate LP oracle price feeds from multiple reporters",
  "xrplLpOracleConfig.ts":         "Configuration loader / validator for the LP oracle bot",
  "xrplLpOracleQuorum.ts":         "LP oracle quorum logic: select median price from reporter set",

  // Manifests & Validation
  "deploymentManifest.ts":              "Read and display the current deployment manifest",
  "signDeploymentManifest.ts":          "Sign the deployment manifest with the deployer key",
  "verifyDeploymentManifest.ts":        "Verify the deployment manifest signature",
  "validateDeploymentRecord.ts":        "Validate a deployment record JSON against the expected schema",
  "securdDeploymentConfig.ts":          "Deployment configuration: addresses, parameters, network settings",
  "validateSecurdDeploymentInputs.ts":  "Validate all deployment input parameters before deploying",
  "validateLiquidationBotConfig.ts":    "Validate the liquidation bot configuration file",
  "validateXrplLpOracleConfig.ts":      "Validate the LP oracle bot configuration file",
  "liquidationBotConfig.ts":           "Configuration loader for the liquidation keeper bot",
};

function main() {
  const allFiles = fs.readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith(".ts") && f !== "listScripts.ts")
    .sort();

  const categorised = new Set<string>();

  console.log("\n" + "═".repeat(72));
  console.log("  Securd — All Scripts");
  console.log("═".repeat(72));

  for (const [category, files] of Object.entries(CATEGORIES)) {
    console.log(`\n${category}`);
    console.log("─".repeat(72));
    for (const file of files) {
      if (!fs.existsSync(path.join(SCRIPTS_DIR, file))) continue;
      const desc = DESCRIPTIONS[file] ?? "(no description)";
      const name = file.replace(".ts", "").padEnd(38);
      console.log(`  ${name}  ${desc}`);
      categorised.add(file);
    }
  }

  // Uncategorised scripts (catch any new ones not yet listed above)
  const uncategorised = allFiles.filter(f => !categorised.has(f));
  if (uncategorised.length > 0) {
    console.log("\n📁 Other");
    console.log("─".repeat(72));
    for (const file of uncategorised) {
      const desc = DESCRIPTIONS[file] ?? "(no description)";
      const name = file.replace(".ts", "").padEnd(38);
      console.log(`  ${name}  ${desc}`);
    }
  }

  console.log("\n" + "═".repeat(72));
  console.log(`  Total: ${allFiles.length} scripts`);
  console.log("═".repeat(72) + "\n");
}

main();
