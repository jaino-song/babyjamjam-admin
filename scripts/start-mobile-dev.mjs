import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLocalEnv } from "./start-local-qa.mjs";

/**
 * `pnpm run dev` for mobile: plain `next dev` (reachable from phones on the LAN, as before),
 * plus the local auto-login settings borrowed from frontend/.env.local — the single local
 * source of truth that `pnpm qa:mobile` already uses. When those settings are missing or the
 * backend is not loopback HTTP, the server still starts, just without automatic login.
 *
 * Automatic login only answers requests addressed to localhost/127.0.0.1 (see
 * src/lib/auth/local-auto-login.ts). Because this server listens on the LAN, a device on the
 * same network can forge that Host header; use `pnpm qa:mobile` (loopback only) on shared networks.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PASSED_KEYS = ["LOCAL_AUTO_LOGIN_EMAIL", "LOCAL_AUTO_LOGIN_PASSWORD", "LOCAL_AUTO_LOGIN_BRANCH_NAME"];

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDirectory = join(repositoryRoot, "mobile");
const sourceEnvPath = join(repositoryRoot, "frontend", ".env.local");

export function resolveAutoLoginEnv(sourceEnv) {
  const email = sourceEnv.LOCAL_AUTO_LOGIN_EMAIL?.trim();
  const password = sourceEnv.LOCAL_AUTO_LOGIN_PASSWORD;
  if (!email || !password) return null;

  let backend;
  try {
    backend = new URL(sourceEnv.DEVELOPMENT_API_BASE_URL ?? sourceEnv.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001");
  } catch {
    return null;
  }
  if (backend.protocol !== "http:" || !LOOPBACK_HOSTS.has(backend.hostname) || backend.username || backend.password) {
    return null;
  }

  const env = { DEVELOPMENT_API_BASE_URL: backend.origin };
  for (const key of PASSED_KEYS) {
    if (sourceEnv[key]) env[key] = sourceEnv[key];
  }
  return env;
}

function run() {
  const sourceEnv = existsSync(sourceEnvPath) ? parseLocalEnv(readFileSync(sourceEnvPath, "utf8")) : {};
  const autoLoginEnv = resolveAutoLoginEnv(sourceEnv);
  console.log(autoLoginEnv
    ? "[mobile dev] local auto-login on (from frontend/.env.local)"
    : "[mobile dev] local auto-login off (no LOCAL_AUTO_LOGIN_* or non-loopback backend in frontend/.env.local)");

  const nextBin = join(mobileDirectory, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2).filter((arg) => arg !== "--")], {
    cwd: mobileDirectory,
    // Values already exported in the shell win over frontend/.env.local.
    env: { ...autoLoginEnv, ...process.env },
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
