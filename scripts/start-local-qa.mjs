import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SUPPORTED_APPS = new Set(["frontend", "mobile"]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "..");
const sourceEnvPath = join(repositoryRoot, "frontend", ".env.local");

function findClosingQuote(value, quote) {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === quote) {
      return index;
    }
  }
  return -1;
}

/**
 * Parse the dotenv syntax needed by the local QA launcher without relying on
 * a runtime helper that is unavailable on early Node 20 releases.
 */
export function parseLocalEnv(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const values = {};

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = lines[lineIndex].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    let rawValue = match[2].trimStart();
    const quote = rawValue[0];
    if (quote === "\"" || quote === "'") {
      let closingIndex = findClosingQuote(rawValue.slice(1), quote);
      const remainingSource = [rawValue, ...lines.slice(lineIndex + 1)].join("\n");
      if (closingIndex === -1 && findClosingQuote(remainingSource.slice(1), quote) !== -1) {
        while (closingIndex === -1 && lineIndex + 1 < lines.length) {
          lineIndex += 1;
          rawValue += `\n${lines[lineIndex]}`;
          closingIndex = findClosingQuote(rawValue.slice(1), quote);
        }
      }

      if (closingIndex === -1) {
        values[key] = rawValue;
        continue;
      }

      const quotedValue = rawValue.slice(1, closingIndex + 1);
      values[key] = quote === "\"" ? quotedValue.replace(/\\n/g, "\n") : quotedValue;
      continue;
    }

    const commentIndex = rawValue.indexOf("#");
    values[key] = (commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex)).trim();
  }

  return values;
}

function isValidPort(value) {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const port = Number(value);
  return port >= 1 && port <= 65_535;
}

function run() {
  const app = process.argv[2];
  const rawForwardedArgs = process.argv.slice(3);
  const forwardedArgs = rawForwardedArgs[0] === "--"
    ? rawForwardedArgs.slice(1)
    : rawForwardedArgs;

  if (!SUPPORTED_APPS.has(app)) {
    throw new Error("Local QA app must be frontend or mobile");
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

  const sourceEnv = parseLocalEnv(readFileSync(sourceEnvPath, "utf8"));
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
