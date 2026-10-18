import path from "node:path";

export type E2eTargetName = "dev" | "preview";

export interface E2eTarget {
  name: E2eTargetName;
  baseURL: string;
  storageStatePath: string;
  credentials: { email: string; password: string } | null;
  /** Branch to pick on /select-branch when the account has more than one. */
  branchName: string | null;
  missingCredentialKeys: string[];
}

const FRONTEND_ROOT = path.resolve(__dirname, "../..");

const BASE_URLS: Record<E2eTargetName, string> = {
  dev: "http://localhost:3000",
  preview: "https://preview.admin.babyjamjam.com",
};

let envFileLoaded = false;

function loadLocalEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  try {
    // Does not override variables already set in the shell.
    process.loadEnvFile(path.join(FRONTEND_ROOT, ".env.local"));
  } catch {
    // No .env.local: rely on the shell environment.
  }
}

function readEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

/** Passwords are used verbatim: surrounding spaces may be part of the password. */
function readPassword(key: string): string | null {
  const value = process.env[key];
  return value ? value : null;
}

export function resolveE2eTarget(): E2eTarget {
  loadLocalEnvFile();

  const rawName = readEnv("E2E_TARGET") ?? "dev";
  if (rawName !== "dev" && rawName !== "preview") {
    throw new Error(`E2E_TARGET must be "dev" or "preview", got "${rawName}"`);
  }
  const name: E2eTargetName = rawName;

  // Credentials are taken as a pair: dev uses E2E_DEV_* when both are set, otherwise the local
  // auto-login account already kept in .env.local. Preview never falls back to local values.
  const pairs: Array<[string, string]> = name === "dev"
    ? [["E2E_DEV_EMAIL", "E2E_DEV_PASSWORD"], ["LOCAL_AUTO_LOGIN_EMAIL", "LOCAL_AUTO_LOGIN_PASSWORD"]]
    : [["E2E_PREVIEW_EMAIL", "E2E_PREVIEW_PASSWORD"]];
  const pair = pairs.find(([emailKey, passwordKey]) => readEnv(emailKey) && readPassword(passwordKey));
  const email = pair ? readEnv(pair[0]) : null;
  const password = pair ? readPassword(pair[1]) : null;
  const missingCredentialKeys = pair ? [] : [...pairs[0]];

  return {
    name,
    baseURL: BASE_URLS[name],
    storageStatePath: path.join(FRONTEND_ROOT, ".auth", `${name}.json`),
    credentials: email && password ? { email, password } : null,
    branchName: readEnv(name === "dev" ? "E2E_DEV_BRANCH_NAME" : "E2E_PREVIEW_BRANCH_NAME"),
    missingCredentialKeys,
  };
}
