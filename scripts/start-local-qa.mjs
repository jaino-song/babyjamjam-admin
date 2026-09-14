import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SUPPORTED_APPS = new Set(["frontend", "mobile"]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "..");
const sourceEnvPath = join(repositoryRoot, "frontend", ".env.local");
const app = process.argv[2];
const rawForwardedArgs = process.argv.slice(3);
const forwardedArgs = rawForwardedArgs[0] === "--"
  ? rawForwardedArgs.slice(1)
  : rawForwardedArgs;

if (!SUPPORTED_APPS.has(app)) {
  throw new Error("Local QA app must be frontend or mobile");
}

function isValidPort(value) {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const port = Number(value);
  return port >= 1 && port <= 65_535;
}

const hasNoPortOverride = forwardedArgs.length === 0;
const hasSeparatedPort = forwardedArgs.length === 2
  && (forwardedArgs[0] === "--port" || forwardedArgs[0] === "-p")
  && isValidPort(forwardedArgs[1]);
const hasInlinePort = forwardedArgs.length === 1
  && forwardedArgs[0].startsWith("--port=")
  && isValidPort(forwardedArgs[0].slice("--port=".length));
if (!hasNoPortOverride && !hasSeparatedPort && !hasInlinePort) {
  throw new Error("Local QA accepts only an optional loopback port override");
}

if (!existsSync(sourceEnvPath)) {
  throw new Error("frontend/.env.local is missing; run env-bootstrap first");
}

const sourceEnv = parseEnv(readFileSync(sourceEnvPath, "utf8"));
const email = sourceEnv.LOCAL_AUTO_LOGIN_EMAIL?.trim();
const password = sourceEnv.LOCAL_AUTO_LOGIN_PASSWORD;
if (!email || !password) {
  throw new Error("Local auto-login credentials are not configured");
}

const backendBaseUrl = sourceEnv.DEVELOPMENT_API_BASE_URL
  ?? sourceEnv.NEXT_PUBLIC_API_BASE_URL
  ?? "http://localhost:3001";
const backend = new URL(backendBaseUrl);
if (
  backend.protocol !== "http:"
  || !LOOPBACK_HOSTS.has(backend.hostname)
  || backend.username
  || backend.password
) {
  throw new Error("Local QA backend must use loopback HTTP");
}

const appDirectory = join(repositoryRoot, app);
const nextBin = join(appDirectory, "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  [nextBin, "dev", "--hostname", "127.0.0.1", ...forwardedArgs],
  {
    cwd: appDirectory,
    env: {
      ...process.env,
      DEVELOPMENT_API_BASE_URL: backend.origin,
      LOCAL_AUTO_LOGIN_EMAIL: email,
      LOCAL_AUTO_LOGIN_PASSWORD: password,
    },
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
