import path from "path";
import { loadLiquidationBotConfig } from "./liquidationBotConfig";

function main() {
  const configPath = process.argv[2] || "config/liquidation-bot.example.json";
  const resolvedPath = path.resolve(configPath);
  const config = loadLiquidationBotConfig(resolvedPath);

  console.log(`Validated liquidation bot config: ${resolvedPath}`);
  console.log(`Network: ${config.network.name} (${config.network.chainId})`);
  console.log(`Wallets: ${config.wallets.length}`);
  console.log(`Asset policies: ${config.assetPolicies.length}`);
}

main();
