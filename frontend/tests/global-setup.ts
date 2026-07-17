import fs from "node:fs";
import path from "node:path";
import { request, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.BASE_URL
    ?? config.projects[0]?.use.baseURL
    ?? "http://localhost:3000";
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    data: {
      email: process.env.E2E_AUTH_EMAIL ?? "admin-a@auth-e2e.test",
      password: process.env.E2E_AUTH_PASSWORD ?? "Password1!",
      autoLogin: true,
    },
  });
  if (!response.ok()) {
    throw new Error(`Real E2E login failed with ${response.status()}`);
  }
  const branchId = process.env.E2E_BRANCH_ID
    ?? "20000000-0000-4000-8000-000000000001";
  const url = new URL(baseURL);
  const storageState = await context.storageState();
  storageState.cookies.push({
    name: "selected_branch_id",
    value: branchId,
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  });
  fs.writeFileSync(
    path.resolve(process.cwd(), "auth.json"),
    JSON.stringify(storageState),
  );
  await context.dispose();

  if (!fs.existsSync(path.resolve(process.cwd(), "auth.json"))) {
    throw new Error("Playwright auth storage state was not created");
  }
}
