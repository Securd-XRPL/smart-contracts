import path from "path";
import { loadXrplLpOracleConfig } from "./xrplLpOracleConfig";

function main() {
  const configPath = process.argv[2] || "config/xrpl-lp-oracle.example.json";
  const resolvedPath = path.resolve(configPath);
  const config = loadXrplLpOracleConfig(resolvedPath);

  console.log(`Validated XRPL LP oracle config: ${resolvedPath}`);
  console.log(`XRPL RPC: ${config.rpc.xrplRpcUrl}`);
  console.log(`XRPL EVM RPC: ${config.rpc.xrplEvmRpcUrl}`);
  console.log(`Pools: ${config.pools.length}`);
}

main();
