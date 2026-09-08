import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const configPath = fileURLToPath(new URL("../phase3-e2e.config.mjs", import.meta.url));
const configEnvKeys = ["BASE_URL", "E2E_PORT"];

function importConfig(overrides = {}) {
  const childEnv = { ...process.env };
  for (const key of configEnvKeys) {
    delete childEnv[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete childEnv[key];
    } else {
      childEnv[key] = value;
    }
  }

  const source = `
    import config from ${JSON.stringify(configPath)};
    console.log(JSON.stringify({
      baseURL: config.use.baseURL,
      serverURL: config.webServer.url,
      command: config.webServer.command,
    }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: childEnv,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status !== 0) {
    return { status: result.status, output };
  }

  const lines = result.stdout.trim().split("\n");
  return { status: result.status, output, config: JSON.parse(lines.at(-1)) };
}

function expectConfig(overrides) {
  const result = importConfig(overrides);
  assert.equal(result.status, 0, result.output);
  return result.config;
}

test("uses the default loopback URL and port when no overrides are supplied", () => {
  const config = expectConfig({ BASE_URL: undefined, E2E_PORT: undefined });

  assert.equal(config.baseURL, "http://localhost:4317");
  assert.equal(config.serverURL, "http://localhost:4317");
  assert.equal(config.command, "pnpm exec next dev --port 4317");
});

test("derives the Next server port from a BASE_URL-only override", () => {
  const config = expectConfig({ BASE_URL: "http://localhost:4321", E2E_PORT: undefined });

  assert.equal(config.baseURL, "http://localhost:4321");
  assert.equal(config.serverURL, "http://localhost:4321");
  assert.equal(config.command, "pnpm exec next dev --port 4321");
});

test("derives the HTTP default port when BASE_URL omits a port", () => {
  const config = expectConfig({ BASE_URL: "http://localhost", E2E_PORT: undefined });

  assert.equal(config.baseURL, "http://localhost");
  assert.equal(config.command, "pnpm exec next dev --port 80");
});

test("builds the loopback URL from an E2E_PORT-only override", () => {
  const config = expectConfig({ BASE_URL: undefined, E2E_PORT: "4322" });

  assert.equal(config.baseURL, "http://localhost:4322");
  assert.equal(config.serverURL, "http://localhost:4322");
  assert.equal(config.command, "pnpm exec next dev --port 4322");
});

test("accepts matching explicit BASE_URL and E2E_PORT settings", () => {
  const config = expectConfig({ BASE_URL: "http://127.0.0.1:4323", E2E_PORT: "4323" });

  assert.equal(config.baseURL, "http://127.0.0.1:4323");
  assert.equal(config.command, "pnpm exec next dev --port 4323");
});

test("rejects explicit BASE_URL and E2E_PORT settings that disagree", () => {
  const result = importConfig({ BASE_URL: "http://localhost:4324", E2E_PORT: "4325" });

  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /BASE_URL port 4324.*E2E_PORT 4325.*match/);
});

test("rejects nonnumeric and out-of-range E2E_PORT values before command construction", () => {
  for (const E2E_PORT of ["4317; touch /tmp/phase3-port", "65536"]) {
    const result = importConfig({ BASE_URL: undefined, E2E_PORT });

    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /E2E_PORT.*1 to 65535/);
  }
});

test("rejects malformed BASE_URL port values", () => {
  const result = importConfig({ BASE_URL: "http://localhost:not-a-port", E2E_PORT: undefined });

  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /BASE_URL to be a valid URL/);
});

test("rejects remote HTTPS BASE_URL values", () => {
  const result = importConfig({ BASE_URL: "https://example.com:4326", E2E_PORT: undefined });

  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /HTTP loopback BASE_URL/);
});
