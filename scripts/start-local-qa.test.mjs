import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseLocalEnv } from "./start-local-qa.mjs";

const launcherPath = fileURLToPath(new URL("./start-local-qa.mjs", import.meta.url));

test("local QA env parsing stays compatible with the declared Node 20 range", async () => {
    const launcherSource = await readFile(launcherPath, "utf8");

    assert.doesNotMatch(launcherSource, /from ["']node:util["']/);
    assert.doesNotMatch(launcherSource, /\bparseEnv\b/);
    assert.deepEqual(
        parseLocalEnv(`
            # comments and surrounding whitespace are ignored
            export LOCAL_AUTO_LOGIN_EMAIL = "qa@example.com" # trailing comment
            LOCAL_AUTO_LOGIN_PASSWORD='qa # password'
            DEVELOPMENT_API_BASE_URL=http://localhost:3001 # trailing comment
        `),
        {
            LOCAL_AUTO_LOGIN_EMAIL: "qa@example.com",
            LOCAL_AUTO_LOGIN_PASSWORD: "qa # password",
            DEVELOPMENT_API_BASE_URL: "http://localhost:3001",
        },
    );
});

test("mobile dev passes the auto-login settings only for a loopback HTTP backend", async () => {
    const { resolveAutoLoginEnv } = await import("./start-mobile-dev.mjs");
    const credentials = {
        LOCAL_AUTO_LOGIN_EMAIL: "qa@example.com",
        LOCAL_AUTO_LOGIN_PASSWORD: " spaced ",
        LOCAL_AUTO_LOGIN_BRANCH_NAME: "고양파주점",
    };

    assert.deepEqual(
        resolveAutoLoginEnv({ ...credentials, DEVELOPMENT_API_BASE_URL: "http://localhost:3001/api" }),
        { DEVELOPMENT_API_BASE_URL: "http://localhost:3001", ...credentials },
    );
    assert.equal(resolveAutoLoginEnv({ ...credentials, DEVELOPMENT_API_BASE_URL: "https://api.example.com" }), null);
    assert.equal(resolveAutoLoginEnv({ ...credentials, DEVELOPMENT_API_BASE_URL: "http://192.168.0.5:3001" }), null);
    assert.equal(resolveAutoLoginEnv({ LOCAL_AUTO_LOGIN_EMAIL: "qa@example.com" }), null);
});

test("mobile dev applies shell-exported values before validating the file settings", async () => {
    const { mergeShellOverrides, resolveAutoLoginEnv } = await import("./start-mobile-dev.mjs");
    const fileEnv = {
        LOCAL_AUTO_LOGIN_EMAIL: "qa@example.com",
        LOCAL_AUTO_LOGIN_PASSWORD: "file-password",
        DEVELOPMENT_API_BASE_URL: "https://api.example.com",
    };

    const merged = mergeShellOverrides(fileEnv, { DEVELOPMENT_API_BASE_URL: "http://127.0.0.1:3001", UNRELATED: "x" });
    assert.deepEqual(resolveAutoLoginEnv(merged), {
        DEVELOPMENT_API_BASE_URL: "http://127.0.0.1:3001",
        LOCAL_AUTO_LOGIN_EMAIL: "qa@example.com",
        LOCAL_AUTO_LOGIN_PASSWORD: "file-password",
    });
    assert.equal(merged.UNRELATED, undefined);
    assert.equal(resolveAutoLoginEnv(mergeShellOverrides(fileEnv, {})), null);
});
