import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const authPath = path.join(os.tmpdir(), "babyjamjam-mobile-phase3-auth.json");

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export default async function globalSetup() {
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

  fs.writeFileSync(authPath, JSON.stringify({
    cookies: [
      {
        name: "auth_token",
        value: token,
        domain: "localhost",
        path: "/",
        expires: expiresAt,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
      {
        name: "e2e_role",
        value: "owner",
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
      {
        name: "selected_branch_id",
        value: "e2e-branch",
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  }));

  process.env.PHASE3_AUTH_STORAGE_STATE = authPath;
}
