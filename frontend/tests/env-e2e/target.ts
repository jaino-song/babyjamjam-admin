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

export function resolveE2eTarget(): E2eTarget {
  loadLocalEnvFile();

  const rawName = readEnv("E2E_TARGET") ?? "dev";
  if (rawName !== "dev" && rawName !== "preview") {
    throw new Error(`E2E_TARGET must be "dev" or "preview", got "${rawName}"`);
  }
  const name: E2eTargetName = rawName;

  // dev falls back to the local auto-login account already kept in .env.local.
  const emailKeys = name === "dev"
    ? ["E2E_DEV_EMAIL", "LOCAL_AUTO_LOGIN_EMAIL"]
    : ["E2E_PREVIEW_EMAIL"];
  const passwordKeys = name === "dev"
    ? ["E2E_DEV_PASSWORD", "LOCAL_AUTO_LOGIN_PASSWORD"]
    : ["E2E_PREVIEW_PASSWORD"];

  const email = emailKeys.map(readEnv).find(Boolean) ?? null;
  const password = passwordKeys.map(readEnv).find(Boolean) ?? null;
  const missingCredentialKeys = [
    ...(email ? [] : [emailKeys[0]]),
    ...(password ? [] : [passwordKeys[0]]),
  ];

  return {
    name,
    baseURL: BASE_URLS[name],
    storageStatePath: path.join(FRONTEND_ROOT, ".auth", `${name}.json`),
    credentials: email && password ? { email, password } : null,
    branchName: readEnv(name === "dev" ? "E2E_DEV_BRANCH_NAME" : "E2E_PREVIEW_BRANCH_NAME"),
    missingCredentialKeys,
  };
}
