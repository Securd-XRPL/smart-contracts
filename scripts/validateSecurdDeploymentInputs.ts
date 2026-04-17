import path from "path";
import {
  loadMarketConfigArray,
  loadTrustedGmpSources,
  loadTrustedItsSources
} from "./securdDeploymentConfig";

function main() {
  const marketsPath = process.argv[2] || "config/securd-markets.example.json";
  const gmpPath = process.argv[3] || "config/trusted-gmp-sources.example.json";
  const itsPath = process.argv[4] || "config/trusted-its-sources.example.json";

  const markets = loadMarketConfigArray(marketsPath);
  const gmpSources = loadTrustedGmpSources(gmpPath);
  const itsSources = loadTrustedItsSources(itsPath);

  console.log(`Validated markets config: ${path.resolve(marketsPath)} (${markets.length} markets)`);
  console.log(`Validated trusted GMP sources: ${path.resolve(gmpPath)} (${gmpSources.length} sources)`);
  console.log(`Validated trusted ITS sources: ${path.resolve(itsPath)} (${itsSources.length} sources)`);
}

main();
