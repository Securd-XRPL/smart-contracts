import path from "path";
import { ethers } from "ethers";
import {
  buildSignedDeploymentManifest,
  resolveDeploymentRecord,
  writeSignedDeploymentManifest
} from "./deploymentManifest";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function main() {
  const recordPath = requiredEnv("DEPLOYMENT_RECORD_FILE");
  const outputPath = requiredEnv("DEPLOYMENT_MANIFEST_FILE");
  const privateKey = requiredEnv("MANIFEST_SIGNER_PRIVATE_KEY");

  const signer = new ethers.Wallet(privateKey);
  const record = resolveDeploymentRecord(recordPath);
  const manifest = buildSignedDeploymentManifest(recordPath, record, signer);
  writeSignedDeploymentManifest(outputPath, manifest);

  console.log(`Signed deployment manifest written to ${path.resolve(outputPath)}`);
  console.log(`Signer: ${manifest.signer}`);
  console.log(`Digest: ${manifest.digest}`);
}

main();
