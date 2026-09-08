import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authFileName = "babyjamjam-mobile-phase3-auth.json";

function runPhase3AuthChild({ tempDir, authStorageState }) {
  const childEnv = { ...process.env, TMPDIR: tempDir };
  delete childEnv.PHASE3_AUTH_STORAGE_STATE;
  if (authStorageState) {
    childEnv.PHASE3_AUTH_STORAGE_STATE = authStorageState;
  }

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import fs from "node:fs";
        import path from "node:path";
        import { default as config } from "./phase3-e2e.config.mjs";
        import globalSetup from "./phase3-e2e-global-setup.mjs";

        await globalSetup({ projects: [{ use: { baseURL: config.use.baseURL } }] });
        const storagePath = config.use.storageState;
        const storageStateExists = fs.existsSync(storagePath);
        const storageState = storageStateExists
          ? JSON.parse(fs.readFileSync(storagePath, "utf8"))
          : null;

        process.stdout.write(JSON.stringify({
          storagePath,
          expectedDefaultPath: path.join(process.env.TMPDIR, ${JSON.stringify(authFileName)}),
          storageStateExists,
          cookieNames: storageState?.cookies?.map((cookie) => cookie.name) ?? [],
        }));
      `,
    ],
    {
      cwd: mobileRoot,
      env: childEnv,
      encoding: "utf8",
    },
  );

  return JSON.parse(output);
}

test("phase 3 config and global setup share the customized TMPDIR auth path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.homedir(), "phase3-auth-path-test-"));

  try {
    const result = runPhase3AuthChild({ tempDir });

    assert.equal(result.storagePath, result.expectedDefaultPath);
    assert.equal(result.storageStateExists, true);
    assert.deepEqual(result.cookieNames, ["auth_token", "e2e_role", "selected_branch_id"]);
    assert.equal(result.storagePath.startsWith("/tmp/"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("phase 3 preserves an explicit auth storage override and creates its parent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.homedir(), "phase3-auth-override-test-"));
  const authStorageState = path.join(tempDir, "nested", "auth", "state.json");

  try {
    const result = runPhase3AuthChild({ tempDir, authStorageState });

    assert.equal(result.storagePath, authStorageState);
    assert.equal(result.storageStateExists, true);
    assert.deepEqual(result.cookieNames, ["auth_token", "e2e_role", "selected_branch_id"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
