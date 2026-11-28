#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LIGHTNODE_REQUEST = "Production-Deploy-Target: lightnode";

function requiresLightNode(commitMessage) {
  const lines = commitMessage.split(/\r?\n/);
  const requests = lines.filter((line) => /^\s*Production-Deploy-Target\b/i.test(line));
  if (requests.length === 0) return false;
  if (requests.length !== 1 || requests[0] !== LIGHTNODE_REQUEST
      || lines.findLast((line) => line.trim()) !== LIGHTNODE_REQUEST) {
    throw new Error("Expected one final Production-Deploy-Target: lightnode trailer.");
  }
  return true;
}

function requireApprovedHashes(fallbackDnsSha256, lightsailDnsSha256) {
  if (!SHA256_PATTERN.test(fallbackDnsSha256 ?? "")
      || !SHA256_PATTERN.test(lightsailDnsSha256 ?? "")) {
    throw new Error("Both approved DNS hashes must be lowercase SHA-256 values.");
  }
  if (fallbackDnsSha256 === lightsailDnsSha256) {
    throw new Error("The approved DNS hashes must be distinct.");
  }
}

export function canonicalDnsHash(records) {
  const canonicalRecords = [...new Set(records.map((record) => record.trim()))].sort();
  if (canonicalRecords.length === 0 || canonicalRecords.some((record) => isIP(record) !== 4)) {
    throw new Error("Production routing must contain at least one valid IPv4 A record.");
  }
  return createHash("sha256")
    .update(`${canonicalRecords.join("\n")}\n`)
    .digest("hex");
}

export function resolveDeployTarget({
  refName,
  dnsRecords = [],
  fallbackDnsSha256,
  lightsailDnsSha256,
  commitMessage = "",
}) {
  if (refName === "preview") return "cloudrun";
  if (refName !== "main") {
    throw new Error("Only preview and main may resolve a backend deployment target.");
  }

  requiresLightNode(commitMessage);
  requireApprovedHashes(fallbackDnsSha256, lightsailDnsSha256);
  const currentDnsSha256 = canonicalDnsHash(dnsRecords);
  if (currentDnsSha256 === fallbackDnsSha256) return "lightnode";
  if (currentDnsSha256 === lightsailDnsSha256) {
    throw new Error("Production is currently routed to the Lightsail standby. Main pushes do not deploy there. Use the Lightsail operations workflow to deploy the standby.");
  }
  throw new Error("The current production route does not match an approved production target.");
}

function readPushedCommitMessage() {
  const head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== process.env.GITHUB_SHA) {
    throw new Error("The checked-out HEAD must match GITHUB_SHA.");
  }
  return execFileSync("git", ["log", "-1", "--format=%B", head, "--"], { encoding: "utf8" });
}

async function main() {
  const refName = process.env.DEPLOY_REF_NAME ?? "";
  const commitMessage = refName === "main" ? readPushedCommitMessage() : "";
  const apiHost = process.env.PUBLIC_API_HOST ?? "api.babyjamjam.com";
  const dnsRecords = refName === "preview"
    ? []
    : process.env.DEPLOY_DNS_RECORDS
      ? process.env.DEPLOY_DNS_RECORDS.split(",")
      : await resolve4(apiHost);
  const target = resolveDeployTarget({
    refName,
    dnsRecords,
    fallbackDnsSha256: process.env.FALLBACK_DNS_SHA256,
    lightsailDnsSha256: process.env.LIGHTSAIL_DNS_SHA256,
    commitMessage,
  });
  process.stdout.write(`target=${target}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Deployment target resolution failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
