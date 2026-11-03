import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    APPROVED_ENV_PATHS, QA_BACKEND_ORIGIN, QA_DATABASE_URL,
    createQaEnvAdapter, parseQaOptions, assertQaDatabase, assertLocalSocketArguments, loopbackOrigin, backendEnvKeys, backendEnvironment,
} from "../../scripts/agent/bjj494-browser-qa.config";
import { withQaLifecycle } from "../../scripts/agent/bjj494-browser-qa";

const LOGICAL = APPROVED_ENV_PATHS[0]!;
const ORIGINAL_URL = "http://localhost:3001";
const FAKE_SECRET = "fake-password-never-public-494";
const ORIGINAL = Buffer.from(`# synthetic\r\nLOCAL_AUTO_LOGIN_PASSWORD=${FAKE_SECRET}\r\nDEVELOPMENT_API_BASE_URL=${ORIGINAL_URL}\r\nOTHER=preserve\r\n`);

describe("BJJ494 private local URL adapter (real temporary files only)", () => {
    let directory: string;
    let envPath: string;
    let atomicPaths: string[];
    const adapter = () => createQaEnvAdapter({
        resolvePath: () => envPath,
        onAtomicTemp: path => {
            atomicPaths.push(path);
            expect(lstatSync(path).mode & 0o777).toBe(0o600);
            expect(path.split("/").at(-1)).toMatch(/^\.env/);
        },
    });
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "bjj494-adapter-test-"));
        envPath = join(directory, ".env.local");
        atomicPaths = [];
        writeFileSync(envPath, ORIGINAL, { mode: 0o600 });
    });
    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it("atomically applies and restores identical bytes, line endings and mode without publishing secrets", () => {
        const log = jest.spyOn(console, "log");
        const error = jest.spyOn(console, "error");
        const instance = adapter();
        const inodeBefore = lstatSync(envPath).ino;
        const applied = instance.apply(LOGICAL);
        expect(lstatSync(envPath).ino).not.toBe(inodeBefore);
        expect(readFileSync(envPath).equals(Buffer.from(ORIGINAL.toString().replace(ORIGINAL_URL, QA_BACKEND_ORIGIN)))).toBe(true);
        expect(lstatSync(envPath).mode & 0o777).toBe(0o600);
        const recovery = readdirSync(directory).find(name => name.endsWith("recovery.json"))!;
        expect(JSON.parse(readFileSync(join(directory, recovery), "utf8"))).toEqual({ originalUrl: ORIGINAL_URL });
        expect(lstatSync(join(directory, recovery)).mode & 0o777).toBe(0o600);
        const restored = instance.restore(LOGICAL);
        expect(readFileSync(envPath).equals(ORIGINAL)).toBe(true);
        expect(lstatSync(envPath).mode & 0o777).toBe(0o600);
        expect(readdirSync(directory)).toEqual([".env.local"]);
        expect(atomicPaths).toHaveLength(2);
        expect(JSON.stringify({ applied, restored, logs: log.mock.calls, errors: error.mock.calls })).not.toContain(FAKE_SECRET);
        log.mockRestore(); error.mockRestore();
    });

    it.each(["/tmp/other/.env.local", "/Users/jaino/Development/babyjamjam-admin/dev/frontend/.env.local"])("refuses unapproved logical path %s before test mapping", path => {
        expect(() => adapter().apply(path)).toThrow();
        expect(readFileSync(envPath).equals(ORIGINAL)).toBe(true);
    });
    it.each([
        { key: "NEXT_PUBLIC_API_BASE_URL", value: QA_BACKEND_ORIGIN },
        { key: "DEVELOPMENT_API_BASE_URL", value: "http://127.0.0.1:63102" },
        { key: "DEVELOPMENT_API_BASE_URL", value: QA_BACKEND_ORIGIN, extraKey: "PASSWORD" },
    ])("refuses another key, value or extra editable key: %o", request => {
        expect(() => adapter().apply(LOGICAL, request)).toThrow();
        expect(readFileSync(envPath).equals(ORIGINAL)).toBe(true);
    });
    it.each([
        "OTHER=value\n",
        `DEVELOPMENT_API_BASE_URL=${ORIGINAL_URL}\nDEVELOPMENT_API_BASE_URL=${ORIGINAL_URL}\n`,
        `DEVELOPMENT_API_BASE_URL=${ORIGINAL_URL}\nexport DEVELOPMENT_API_BASE_URL=${ORIGINAL_URL}\n`,
        `DEVELOPMENT_API_BASE_URL=${QA_BACKEND_ORIGIN}\n`,
        "DEVELOPMENT_API_BASE_URL=https://remote.example\n",
    ])("fails closed on missing/duplicate/already-adapted/nonloopback key", source => {
        writeFileSync(envPath, source);
        expect(() => adapter().apply(LOGICAL)).toThrow();
        expect(readFileSync(envPath, "utf8")).toBe(source);
    });
    it("refuses an existing recovery record, even when the URL was manually restored", () => {
        adapter().apply(LOGICAL);
        writeFileSync(envPath, ORIGINAL);
        expect(() => adapter().apply(LOGICAL)).toThrow();
    });
    it("preserves unrelated edits on restore", () => {
        const instance = adapter(); instance.apply(LOGICAL);
        writeFileSync(envPath, readFileSync(envPath, "utf8").replace("OTHER=preserve", "OTHER=changed"));
        instance.restore(LOGICAL);
        expect(readFileSync(envPath, "utf8")).toBe(ORIGINAL.toString().replace("OTHER=preserve", "OTHER=changed"));
    });
    it("refuses a concurrent change to the owned line without clobbering it", () => {
        const instance = adapter(); instance.apply(LOGICAL);
        const changed = readFileSync(envPath, "utf8").replace(QA_BACKEND_ORIGIN, "http://localhost:9876");
        writeFileSync(envPath, changed);
        expect(() => instance.restore(LOGICAL)).toThrow();
        expect(readFileSync(envPath, "utf8")).toBe(changed);
    });
    it("refuses a symlink or nonprivate file", () => {
        chmodSync(envPath, 0o644);
        expect(() => adapter().apply(LOGICAL)).toThrow();
        rmSync(envPath); const target = join(directory, "target");
        writeFileSync(target, ORIGINAL, { mode: 0o600 }); symlinkSync(target, envPath);
        expect(() => adapter().apply(LOGICAL)).toThrow();
    });
});

describe("BJJ494 fail-closed configuration", () => {
    it("requires both exact disposable DB URLs", () => {
        expect(() => assertQaDatabase(QA_DATABASE_URL, QA_DATABASE_URL)).not.toThrow();
        for (const wrong of [undefined, "", `${QA_DATABASE_URL}?x=1`, "postgresql://localhost/other"]) {
            expect(() => assertQaDatabase(wrong, QA_DATABASE_URL)).toThrow();
            expect(() => assertQaDatabase(QA_DATABASE_URL, wrong)).toThrow();
        }
    });
    it.each(["http://user:pass@127.0.0.1:3001", "http://127.0.0.1:3001/?x=1", "http://127.0.0.1:3001/#frag", "https://localhost:3001", "http://example.com", "garbage"])("refuses unsafe origin without echoing it", value => {
        expect(() => loopbackOrigin(value)).toThrow("Invalid local QA origin");
    });
    it("accepts only known options and roles; has no test IO mapping on CLI", () => {
        expect(parseQaOptions(["--mode", "agent", "--role", "admin"])).toEqual({ mode: "agent", role: "admin", internalBackend: false, recover: false });
        for (const args of [["--mode", "other"], ["--role", "owner"], ["--test-path", "/tmp/x"], ["--mode", "agent", "--mode", "legacy"], ["--unknown"]]) {
            expect(() => parseQaOptions(args)).toThrow();
        }
    });
    it("blanks dotenv assignment names including multiline values and refuses invalid keys", () => {
        expect(backendEnvKeys("KEY=value\nexport NEXT: value\nPRIVATE=\"one\ntwo\"\n")).toEqual(["KEY", "NEXT", "PRIVATE"]);
        expect(() => backendEnvKeys("BAD.KEY=secret")).toThrow();
        expect(() => backendEnvKeys("BAD-KEY: secret")).toThrow();
    });
    it("never carries caller/vendor secrets into backend children and shadows every loadable file", () => {
        const root = mkdtempSync(join(tmpdir(), "bjj494-env-test-"));
        process.env["BJJ494_FAKE_CALLER_SECRET"] = FAKE_SECRET;
        try {
            for (const directory of [root, join(root, "backend"), join(root, "backend", "backend")]) {
                mkdirSync(directory, { recursive: true });
                writeFileSync(join(directory, ".env"), `VENDOR_SECRET=${FAKE_SECRET}\n`);
                writeFileSync(join(directory, ".env.local"), `OTHER_SECRET=${FAKE_SECRET}\n`);
            }
            const environment = backendEnvironment(root);
            expect(environment["VENDOR_SECRET"]).toBe("");
            expect(environment["OTHER_SECRET"]).toBe("");
            expect(environment["BJJ494_FAKE_CALLER_SECRET"]).toBeUndefined();
            expect(environment["AUTH_RATE_LIMIT_DISABLED"]).not.toBe("true");
            expect(environment["AGENT_WRITE_ENABLED"]).not.toBe("true");
            expect(JSON.stringify(environment)).not.toContain(FAKE_SECRET);
            assertQaDatabase(environment["DATABASE_URL"], environment["DIRECT_URL"]);
        } finally { delete process.env["BJJ494_FAKE_CALLER_SECRET"]; rmSync(root, { recursive: true, force: true }); }
    });
    it("permits local sockets and refuses accidental external backend egress", () => {
        for (const args of [[{ host: "127.0.0.1", port: 63101 }], [63101, "localhost"], [[{ host: "::1", port: 63101 }]], [{ path: "/tmp/local-ipc" }]]) {
            expect(() => assertLocalSocketArguments(args)).not.toThrow();
        }
        for (const args of [[{ host: "vendor.example", port: 443 }], [443, "1.1.1.1"], [[{ host: "vendor.example" }]]]) {
            expect(() => assertLocalSocketArguments(args)).toThrow("External network is disabled");
        }
    });
    it("adapts before startup and restores only after every owned Next and backend exit", async () => {
        const events: string[] = [];
        const step = (name: string) => async () => { events.push(name); };
        await withQaLifecycle({ apply: step("apply"), start: step("start"), wait: step("wait"), stopNext: step("next-groups-and-ports-closed"), stopBackend: step("backend-group-and-port-closed"), restore: step("restore"), stopPg: step("pg-stop") });
        expect(events).toEqual(["apply", "start", "wait", "next-groups-and-ports-closed", "backend-group-and-port-closed", "restore", "pg-stop"]);
    });
    it("keeps recovery metadata and refuses URL restore if Next shutdown cannot be verified", async () => {
        const restore = jest.fn(); const stopPg = jest.fn(); const stopBackend = jest.fn();
        await expect(withQaLifecycle({ apply: async () => {}, start: async () => {}, wait: async () => {}, stopNext: async () => { throw new Error("still listening"); }, stopBackend, restore, stopPg })).rejects.toThrow();
        expect(restore).not.toHaveBeenCalled(); expect(stopBackend).toHaveBeenCalled(); expect(stopPg).toHaveBeenCalled();
    });
});
