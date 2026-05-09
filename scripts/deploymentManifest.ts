import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { DeploymentSummary, loadDeploymentSummary } from "./securdDeploymentConfig";

export interface SignedDeploymentManifest {
  schemaVersion: number;
  recordPath: string;
  digest: string;
  signer: string;
  signature: string;
  signedAt: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export function deploymentDigest(recordPath: string, record: DeploymentSummary): string {
  // Include recordPath in the digest to prevent an attacker from substituting a different
  // record file while reusing a valid signature obtained for another path.
  return ethers.keccak256(ethers.toUtf8Bytes(stableStringify({ recordPath, record })));
}

export function buildSignedDeploymentManifest(recordPath: string, record: DeploymentSummary, signer: ethers.Wallet): SignedDeploymentManifest {
  const digest = deploymentDigest(recordPath, record);
  const signature = signer.signMessageSync(ethers.getBytes(digest));

  return {
    schemaVersion: 1,
    recordPath,
    digest,
    signer: signer.address,
    signature,
    signedAt: new Date().toISOString()
  };
}

export function loadSignedDeploymentManifest(manifestPath: string): SignedDeploymentManifest {
  const resolved = path.resolve(manifestPath);
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as SignedDeploymentManifest;
}

export function resolveDeploymentRecord(recordPath: string): DeploymentSummary {
  return loadDeploymentSummary(recordPath);
}

export function writeSignedDeploymentManifest(manifestPath: string, manifest: SignedDeploymentManifest) {
  const resolved = path.resolve(manifestPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function verifySignedDeploymentManifest(recordPath: string, manifest: SignedDeploymentManifest) {
  const record = resolveDeploymentRecord(recordPath);
  const digest = deploymentDigest(recordPath, record);
  if (digest !== manifest.digest) {
    throw new Error(`Manifest digest mismatch: expected ${digest}, got ${manifest.digest}`);
  }

  const recovered = ethers.verifyMessage(ethers.getBytes(digest), manifest.signature);
  if (recovered.toLowerCase() !== manifest.signer.toLowerCase()) {
    throw new Error(`Manifest signer mismatch: expected ${manifest.signer}, got ${recovered}`);
  }

  return { digest, recovered };
}
