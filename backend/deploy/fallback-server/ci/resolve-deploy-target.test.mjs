import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const lightsailStandbyError = /Production is currently routed to the Lightsail standby\. Main pushes do not deploy there\. Use the Lightsail operations workflow to deploy the standby\./;

test("main refuses the Lightsail standby route without a target trailer", () => {
  const lightsailRecords = ["192.0.2.20"];

  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: lightsailRecords,
    fallbackDnsSha256: hash(["192.0.2.10"]),
    lightsailDnsSha256: hash(lightsailRecords),
  }), lightsailStandbyError);
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
  }), lightsailStandbyError);
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

test("the CLI resolves main only from the exact pushed commit", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "resolve-deploy-target-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  git("init", "--quiet", "--template=");
  git("config", "user.name", "Release Fixture");
  git("config", "user.email", "release@example.test");
  git("commit", "--quiet", "--allow-empty", "-m", "Previous release");
  const previous = git("rev-parse", "HEAD");
  git("commit", "--quiet", "--allow-empty", "-m", "Release", "-m", lightnodeTrailer);
  const head = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "--detach", head);

  const resolver = fileURLToPath(new URL("./resolve-deploy-target.mjs", import.meta.url));
  const run = (overrides) => spawnSync(process.execPath, [resolver], {
    cwd,
    encoding: "utf8",
    env: {
      ...env,
      DEPLOY_REF_NAME: "main",
      DEPLOY_DNS_RECORDS: "192.0.2.10",
      FALLBACK_DNS_SHA256: requestedRelease.fallbackDnsSha256,
      LIGHTSAIL_DNS_SHA256: requestedRelease.lightsailDnsSha256,
      ...overrides,
    },
  });

  const exact = run({ GITHUB_SHA: head });
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(exact.stdout, "target=lightnode\n");

  const wrongRoute = run({ GITHUB_SHA: head, DEPLOY_DNS_RECORDS: "192.0.2.20" });
  assert.equal(wrongRoute.status, 1);
  assert.equal(wrongRoute.stdout, "");
  assert.match(wrongRoute.stderr, lightsailStandbyError);

  for (const overrides of [{ GITHUB_SHA: previous }, { GITHUB_SHA: head.slice(0, 12) }, {}]) {
    const refused = run(overrides);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /checked-out HEAD must match GITHUB_SHA/);
  }

  const preview = run({ DEPLOY_REF_NAME: "preview" });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.stdout, "target=cloudrun\n");

  git("checkout", "--quiet", "--detach", previous);
  const standbyRoute = run({ GITHUB_SHA: previous, DEPLOY_DNS_RECORDS: "192.0.2.20" });
  assert.equal(standbyRoute.status, 1);
  assert.equal(standbyRoute.stdout, "");
  assert.match(standbyRoute.stderr, lightsailStandbyError);
});
