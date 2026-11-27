import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalDnsHash,
  resolveDeployTarget,
} from "./resolve-deploy-target.mjs";

function hash(records) {
  return createHash("sha256")
    .update(`${[...records].sort().join("\n")}\n`)
    .digest("hex");
}

test("preview always targets Cloud Run without production routing secrets", () => {
  assert.equal(resolveDeployTarget({ refName: "preview" }), "cloudrun");
});

test("main targets LightNode only when the authoritative A-record hash matches", () => {
  const fallbackRecords = ["192.0.2.10"];

  assert.equal(resolveDeployTarget({
    refName: "main",
    dnsRecords: fallbackRecords,
    fallbackDnsSha256: hash(fallbackRecords),
    lightsailDnsSha256: hash(["192.0.2.20"]),
  }), "lightnode");
});

test("main targets Lightsail only when its registered A-record hash matches", () => {
  const lightsailRecords = ["192.0.2.20"];

  assert.equal(resolveDeployTarget({
    refName: "main",
    dnsRecords: lightsailRecords,
    fallbackDnsSha256: hash(["192.0.2.10"]),
    lightsailDnsSha256: hash(lightsailRecords),
  }), "lightsail");
});

const lightnodeTrailer = "Production-Deploy-Target: lightnode";
const requestedRelease = {
  refName: "main",
  fallbackDnsSha256: hash(["192.0.2.10"]),
  lightsailDnsSha256: hash(["192.0.2.20"]),
  commitMessage: `Merge release to main\n\nRelease notes\n\n${lightnodeTrailer}\n`,
};

test("a LightNode-only release needs the approved LightNode DNS route", () => {
  assert.equal(resolveDeployTarget({
    ...requestedRelease,
    dnsRecords: ["192.0.2.10"],
  }), "lightnode");
  assert.throws(() => resolveDeployTarget({
    ...requestedRelease,
    dnsRecords: ["192.0.2.20"],
  }), /requires LightNode.*Lightsail/);
  assert.throws(() => resolveDeployTarget({
    ...requestedRelease,
    dnsRecords: ["192.0.2.30"],
  }), /does not match an approved production target/);
  assert.throws(() => resolveDeployTarget({
    ...requestedRelease,
    dnsRecords: ["not-an-ip"],
  }), /valid IPv4/);
});

test("main refuses malformed, misplaced, or duplicate production target requests", () => {
  const invalidRequests = [
    "Production-Deploy-Target: lightsail",
    "Production-Deploy-Target:",
    "Production-Deploy-Target = lightnode",
    "production-deploy-target: lightnode",
    ` ${lightnodeTrailer}`,
    `${lightnodeTrailer}\n\nRelease notes`,
    `${lightnodeTrailer}\n\n${lightnodeTrailer}`,
    `Production-Deploy-Target: lightsail\n${lightnodeTrailer}`,
  ];

  for (const request of invalidRequests) {
    assert.throws(() => resolveDeployTarget({
      ...requestedRelease,
      dnsRecords: ["192.0.2.10"],
      commitMessage: `Merge release to main\n\n${request}\n`,
    }), /Expected one final Production-Deploy-Target: lightnode trailer/, request);
  }
});

test("preview ignores production target requests", () => {
  assert.equal(resolveDeployTarget({
    refName: "preview",
    commitMessage: `${lightnodeTrailer}\n${lightnodeTrailer}`,
  }), "cloudrun");
});

test("main fails closed for an unregistered or mixed routing identity", () => {
  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: ["192.0.2.10", "192.0.2.20"],
    fallbackDnsSha256: hash(["192.0.2.10"]),
    lightsailDnsSha256: hash(["192.0.2.20"]),
  }), /does not match an approved production target/);
});

test("main rejects missing, duplicate, or malformed target hashes", () => {
  const records = ["192.0.2.10"];
  const approvedHash = hash(records);

  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: records,
    fallbackDnsSha256: "",
    lightsailDnsSha256: approvedHash,
  }), /approved DNS hashes/);
  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: records,
    fallbackDnsSha256: approvedHash,
    lightsailDnsSha256: approvedHash,
  }), /must be distinct/);
  assert.throws(() => canonicalDnsHash(["not-an-ip"]), /valid IPv4/);
});
