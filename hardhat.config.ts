import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "solidity-coverage";

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const xrplEvmRpcUrl = process.env.XRPL_EVM_RPC_URL;

const xrplEvmNetwork = xrplEvmRpcUrl
  ? {
      xrplEvm: {
        url: xrplEvmRpcUrl,
        chainId: Number(process.env.XRPL_EVM_CHAIN_ID || 1440002),
        accounts: deployerPrivateKey ? [deployerPrivateKey] : []
      }
    }
  : {};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: xrplEvmNetwork,
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 120000
  }
};

export default config;
