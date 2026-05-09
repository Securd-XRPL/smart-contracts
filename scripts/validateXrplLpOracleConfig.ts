import path from "path";
import { loadXrplLpOracleConfig } from "./xrplLpOracleConfig";

function redactUrlCredentials(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    return u.toString();
  } catch {
    return "<invalid URL>";
  }
}

function main() {
  const configPath = process.argv[2] || "config/xrpl-lp-oracle.example.json";
  const resolvedPath = path.resolve(configPath);
  const config = loadXrplLpOracleConfig(resolvedPath);

  console.log(`Validated XRPL LP oracle config: ${resolvedPath}`);
  console.log(`XRPL RPC: ${redactUrlCredentials(config.rpc.xrplRpcUrl)}`);
  console.log(`XRPL EVM RPC: ${redactUrlCredentials(config.rpc.xrplEvmRpcUrl)}`);
  console.log(`Pools: ${config.pools.length}`);
}

main();
