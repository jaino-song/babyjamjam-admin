import fs from "node:fs";
import path from "node:path";
import { phase3AuthStorageStatePath } from "./phase3-e2e-auth-path.mjs";

const defaultBaseURL = "http://localhost:4317";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function getEffectiveBaseURL(config) {
  const configuredBaseURL = config?.projects?.[0]?.use?.baseURL;
  return configuredBaseURL ?? process.env.BASE_URL ?? defaultBaseURL;
}

export function cookieDomainFromBaseURL(baseURL) {
  const hostname = new URL(baseURL).hostname;
  const unbracketedHostname = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return unbracketedHostname.includes(":")
    ? `[${unbracketedHostname}]`
    : unbracketedHostname;
}

export function createSyntheticCookies(baseURL, token, expiresAt) {
  const domain = cookieDomainFromBaseURL(baseURL);
  return [
    {
      name: "auth_token",
      value: token,
      domain,
      path: "/",
      expires: expiresAt,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "e2e_role",
      value: "owner",
      domain,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "selected_branch_id",
      value: "e2e-branch",
      domain,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ];
}

export default async function globalSetup(config) {
  const baseURL = getEffectiveBaseURL(config);
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = [
    base64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64Url(JSON.stringify({
      sub: "e2e-user",
      sid: "e2e-session",
      role: "owner",
      branchId: "e2e-branch",
      type: "access",
      exp: expiresAt,
    })),
    "fixture",
  ].join(".");

  fs.mkdirSync(path.dirname(phase3AuthStorageStatePath), { recursive: true });
  fs.writeFileSync(phase3AuthStorageStatePath, JSON.stringify({
    cookies: createSyntheticCookies(baseURL, token, expiresAt),
    origins: [],
  }));
}
