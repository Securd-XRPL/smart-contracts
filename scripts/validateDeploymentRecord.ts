import path from "path";
import { loadDeploymentSummary } from "./securdDeploymentConfig";

function main() {
  const recordPath = process.argv[2];
  if (!recordPath) {
    throw new Error("Usage: ts-node scripts/validateDeploymentRecord.ts <deployment-json-path>");
  }

  const record = loadDeploymentSummary(recordPath);
  console.log(`Validated deployment record: ${path.resolve(recordPath)}`);
  console.log(`Owner: ${record.owner}`);
  console.log(`Unitroller: ${record.unitroller}`);
  console.log(`Markets: ${record.markets.length}`);
}

main();
