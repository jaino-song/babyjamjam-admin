import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import type { FullConfig } from "@playwright/test";

function readJwtSecret(): string {
  // CI provides the secret via env; local dev falls back to backend/.env.
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const envPath = path.resolve(process.cwd(), "../backend/.env");
  const env = fs.readFileSync(envPath, "utf-8");
  const line = env
    .split("\n")
    .find((l) => l.startsWith("JWT_SECRET="))
    ?.trim();
  if (!line) {
    throw new Error("JWT_SECRET not found in env or ../backend/.env");
  }
  return line.slice("JWT_SECRET=".length);
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signJwtHS256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64url(sig)}`;
}

export default async function globalSetup(config: FullConfig) {
  void config;

  const secret = readJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60;

  // Local dev IDs (matches backend JWT expectations used in other scripts).
  const userId = process.env.E2E_USER_ID || "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
  const branchId = process.env.E2E_ORG_ID || "33dbe950-1574-4951-b7b4-92d97ab29512";

  const token = signJwtHS256(
    {
      sub: userId,
      role: "owner",
      branchId,
      branchRole: "admin",
      type: "access",
      exp,
    },
    secret
  );

  const storageState = {
    cookies: [
      {
        name: "auth_token",
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
        expires: exp,
      },
      {
        name: "selected_branch_id",
        value: branchId,
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
        expires: exp,
      },
    ],
    origins: [],
  };

  fs.writeFileSync(path.resolve(process.cwd(), "auth.json"), JSON.stringify(storageState, null, 2));
}
