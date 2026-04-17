import path from "path";
import { loadSignedDeploymentManifest, verifySignedDeploymentManifest } from "./deploymentManifest";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function main() {
  const recordPath = requiredEnv("DEPLOYMENT_RECORD_FILE");
  const manifestPath = requiredEnv("DEPLOYMENT_MANIFEST_FILE");
  const manifest = loadSignedDeploymentManifest(manifestPath);
  const result = verifySignedDeploymentManifest(recordPath, manifest);

  console.log(`Verified deployment manifest: ${path.resolve(manifestPath)}`);
  console.log(`Record: ${path.resolve(recordPath)}`);
  console.log(`Signer: ${result.recovered}`);
  console.log(`Digest: ${result.digest}`);
}

main();
