import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { loadWorkerConfig } from "infrastructure/eformsign-backup/worker/config";

import { ARCHIVE_ID, COMPANY, configJson, makeBase } from "./helpers/runner-support";

describe("loadWorkerConfig", () => {
    let base: string;
    let counter = 0;
    const paths = () => ({
        control: path.join(base, "control"), archive: path.join(base, "archive"), tokenPath: path.join(base, "token"),
        baseUrl: "http://127.0.0.1:9/internal/eformsign-backup/v1",
    });
    beforeAll(async () => { base = await makeBase("bjj455-config-"); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

    async function write(json: unknown, mode = 0o600): Promise<string> {
        const file = path.join(base, `config-${++counter}.json`);
        await fs.writeFile(file, typeof json === "string" ? json : JSON.stringify(json), { mode });
        await fs.chmod(file, mode);
        return file;
    }
    const refused = { reasonCode: "config-invalid" };

    it("should load a valid config and return a deeply frozen object", async () => {
        const config = await loadWorkerConfig(await write(configJson(paths())));
        expect(config).toMatchObject({
            schemaVersion: 1, enabled: true, companyId: COMPANY, requestTimeoutMs: 20_000,
            control: { path: paths().control, reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000 },
            archive: { path: paths().archive, archiveId: ARCHIVE_ID, requireMountPoint: false },
        });
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.control)).toBe(true);
        expect(Object.isFrozen(config.archive)).toBe(true);
    });

    it("should default enabled to false, requireMountPoint to true and the timeout to 120000", async () => {
        const json = configJson(paths()) as Record<string, any>;
        delete json["enabled"];
        delete json["requestTimeoutMs"];
        delete json["archive"].requireMountPoint;
        const config = await loadWorkerConfig(await write(json));
        expect(config.enabled).toBe(false);
        expect(config.archive.requireMountPoint).toBe(true);
        expect(config.requestTimeoutMs).toBe(120_000);
    });

    it("should accept https and http only for loopback hosts", async () => {
        const url = (exportBaseUrl: string) => configJson(paths(), { exportBaseUrl } as never);
        await expect(loadWorkerConfig(await write(url("https://backup.example.test/internal/eformsign-backup/v1")))).resolves.toBeDefined();
        await expect(loadWorkerConfig(await write(url("http://localhost:3000/v1")))).resolves.toBeDefined();
        await expect(loadWorkerConfig(await write(url("http://[::1]:3000/v1")))).resolves.toBeDefined();
        await expect(loadWorkerConfig(await write(url("http://backup.example.test/v1")))).rejects.toMatchObject(refused);
        await expect(loadWorkerConfig(await write(url("ftp://127.0.0.1/v1")))).rejects.toMatchObject(refused);
        await expect(loadWorkerConfig(await write(url("https://user:pw@backup.example.test/v1")))).rejects.toMatchObject(refused);
    });

    function variant(mutate: (json: Record<string, any>) => void): Record<string, any> {
        const json = configJson(paths()) as Record<string, any>;
        mutate(json);
        return json;
    }

    it.each([
        ["an unknown top-level field", (j: Record<string, any>) => { j["extra"] = 1; }],
        ["an unknown nested field", (j: Record<string, any>) => { j["archive"].extra = 1; }],
        ["schemaVersion 2", (j: Record<string, any>) => { j["schemaVersion"] = 2; }],
        ["a non-boolean enabled", (j: Record<string, any>) => { j["enabled"] = "yes"; }],
        ["a company id that is not an identifier", (j: Record<string, any>) => { j["companyId"] = "bad id!"; }],
        ["a 256 character company id", (j: Record<string, any>) => { j["companyId"] = "c".repeat(256); }],
        ["a relative token path", (j: Record<string, any>) => { j["tokenFile"] = "token"; }],
        ["a relative control path", (j: Record<string, any>) => { j["control"].path = "control"; }],
        ["a control path with ..", (j: Record<string, any>) => { j["control"].path = `${paths().control}/../x`; }],
        ["a trailing slash", (j: Record<string, any>) => { j["archive"].path = `${paths().archive}/`; }],
        ["the filesystem root as archive", (j: Record<string, any>) => { j["archive"].path = "/"; }],
        ["reserveBytes below 64 MiB", (j: Record<string, any>) => { j["control"].reserveBytes = 64 * 1024 * 1024 - 1; }],
        ["reserveInodes below 1000", (j: Record<string, any>) => { j["archive"].reserveInodes = 999; }],
        ["a non-integer reserve", (j: Record<string, any>) => { j["archive"].reserveBytes = 1.5e9 + 0.5; }],
        ["an archive id that is not a uuid", (j: Record<string, any>) => { j["archive"].archiveId = "archive-1"; }],
        ["a control path inside the archive", (j: Record<string, any>) => { j["control"].path = `${paths().archive}/control`; }],
        ["an archive path inside the control path", (j: Record<string, any>) => { j["archive"].path = `${paths().control}/archive`; }],
        ["the same path for control and archive", (j: Record<string, any>) => { j["archive"].path = paths().control; }],
        ["a timeout of 0", (j: Record<string, any>) => { j["requestTimeoutMs"] = 0; }],
        ["a token file inside the archive", (j: Record<string, any>) => { j["tokenFile"] = `${paths().archive}/token`; }],
    ])("should refuse with config-invalid for %s", async (_name, mutate) => {
        await expect(loadWorkerConfig(await write(variant(mutate)))).rejects.toMatchObject(refused);
    });

    describe("the optional drive block (BJJ-456)", () => {
        const driveBlock = () => ({ clientFile: path.join(base, "client.json"), refreshTokenFile: path.join(base, "refresh-token") });
        const withDrive = (drive: Record<string, unknown>, mutate: (json: Record<string, any>) => void = () => undefined) =>
            variant((json) => { json["drive"] = drive; mutate(json); });

        it("should accept the block with only the two secret files and fill every default", async () => {
            const config = await loadWorkerConfig(await write(withDrive(driveBlock())));
            expect(config.drive).toEqual({
                ...driveBlock(), tokenUrl: "https://oauth2.googleapis.com/token", apiBaseUrl: "https://www.googleapis.com",
                uploadBaseUrl: "https://www.googleapis.com", rootFolderName: "bjj-eformsign-backup", chunkBytes: 8_388_608,
            });
            expect(Object.isFrozen(config.drive)).toBe(true);
        });

        it("should keep explicit values and accept http for loopback hosts only", async () => {
            const block = {
                ...driveBlock(), tokenUrl: "http://127.0.0.1:9/token", apiBaseUrl: "http://localhost:9/api", uploadBaseUrl: "http://[::1]:9/upload",
                rootFolderName: "custom-root", chunkBytes: 262_144 * 3, requestTimeoutMs: 7000,
            };
            const config = await loadWorkerConfig(await write(withDrive(block)));
            expect(config.drive).toEqual(block);
        });

        it("should leave a config without a drive block exactly as before", async () => {
            const config = await loadWorkerConfig(await write(configJson(paths())));
            expect(config.drive).toBeUndefined();
            expect("drive" in config).toBe(false);
        });

        it.each([
            ["http for a non-loopback token url", { tokenUrl: "http://oauth.example.test/token" }],
            ["http for a non-loopback api url", { apiBaseUrl: "http://drive.example.test" }],
            ["http for a non-loopback upload url", { uploadBaseUrl: "http://drive.example.test" }],
            ["credentials in a url", { apiBaseUrl: "https://user:pw@drive.example.test" }],
            ["a query in a url", { uploadBaseUrl: "https://drive.example.test/?x=1" }],
            ["a url that is not a url", { tokenUrl: "not a url" }],
            ["a relative client file", { clientFile: "client.json" }],
            ["a relative refresh token file", { refreshTokenFile: "refresh-token" }],
            ["a client file path with ..", { clientFile: "/secrets/../client.json" }],
            ["an unknown key", { extra: true }],
            ["an empty root folder name", { rootFolderName: "" }],
            ["a 256 character root folder name", { rootFolderName: "r".repeat(256) }],
            ["a root folder name with a control character", { rootFolderName: "bad\nname" }],
            ["a chunk size that is not a multiple of 256 KiB", { chunkBytes: 262_144 + 1 }],
            ["a chunk size of 0", { chunkBytes: 0 }],
            ["a chunk size below 256 KiB", { chunkBytes: 131_072 }],
            ["a fractional chunk size", { chunkBytes: 262_144.5 }],
            ["a drive timeout of 0", { requestTimeoutMs: 0 }],
            ["a drive timeout above ten minutes", { requestTimeoutMs: 10 * 60 * 1000 + 1 }],
        ])("should refuse with config-invalid for %s", async (_name, extra) => {
            await expect(loadWorkerConfig(await write(withDrive({ ...driveBlock(), ...extra })))).rejects.toMatchObject(refused);
        });

        it.each([
            ["missing the client file", () => ({ refreshTokenFile: path.join(base, "refresh-token") })],
            ["missing the refresh token file", () => ({ clientFile: path.join(base, "client.json") })],
        ])("should refuse a drive block %s", async (_name, block) => {
            await expect(loadWorkerConfig(await write(withDrive(block())))).rejects.toMatchObject(refused);
        });

        it.each([
            ["the client file inside the archive", () => ({ clientFile: `${paths().archive}/client.json` })],
            ["the refresh token file inside the archive", () => ({ refreshTokenFile: `${paths().archive}/sub/refresh-token` })],
            ["the client file inside the control path", () => ({ clientFile: `${paths().control}/client.json` })],
            ["the refresh token file inside the control path", () => ({ refreshTokenFile: `${paths().control}/ledger/refresh-token` })],
            ["the client file at the archive path itself", () => ({ clientFile: paths().archive })],
        ])("should refuse %s", async (_name, extra) => {
            await expect(loadWorkerConfig(await write(withDrive({ ...driveBlock(), ...extra() })))).rejects.toMatchObject(refused);
        });

        it("should not mistake a sibling directory with a shared name prefix for the archive", async () => {
            const block = { ...driveBlock(), clientFile: `${paths().archive}-secrets/client.json` };
            await expect(loadWorkerConfig(await write(withDrive(block)))).resolves.toBeDefined();
        });
    });

    it("should refuse invalid JSON and an oversized file", async () => {
        await expect(loadWorkerConfig(await write("{not json"))).rejects.toMatchObject(refused);
        await expect(loadWorkerConfig(await write("[]"))).rejects.toMatchObject(refused);
        await expect(loadWorkerConfig(await write(" ".repeat(70_000) + JSON.stringify(configJson(paths()))))).rejects.toMatchObject(refused);
    });

    it("should refuse a relative path, a missing file, a directory and a symlink", async () => {
        await expect(loadWorkerConfig("worker.json")).rejects.toMatchObject(refused);
        await expect(loadWorkerConfig(path.join(base, "absent.json"))).rejects.toMatchObject(refused);
        await expect(loadWorkerConfig(base)).rejects.toMatchObject(refused);
        const real = await write(configJson(paths()));
        const link = path.join(base, "link.json");
        await fs.symlink(real, link);
        await expect(loadWorkerConfig(link)).rejects.toMatchObject(refused);
    });

    it.each([0o620, 0o602, 0o666, 0o622])("should refuse a config file that others can write (mode %o)", async (mode) => {
        await expect(loadWorkerConfig(await write(configJson(paths()), mode))).rejects.toMatchObject(refused);
    });

    it("should accept a 0644 and a 0400 file (only writes by others matter)", async () => {
        await expect(loadWorkerConfig(await write(configJson(paths()), 0o644))).resolves.toBeDefined();
        await expect(loadWorkerConfig(await write(configJson(paths()), 0o400))).resolves.toBeDefined();
    });

    it("should refuse a config file that is not owned by the worker user", async () => {
        const file = await write(configJson(paths()));
        const realUid = process.getuid!();
        const spy = jest.spyOn(process, "getuid").mockReturnValue(realUid + 1);
        try {
            await expect(loadWorkerConfig(file)).rejects.toMatchObject(refused);
        } finally {
            spy.mockRestore();
        }
        await expect(loadWorkerConfig(file)).resolves.toBeDefined();
    });

    it("should expose only the reason code, never the path or a JSON error", async () => {
        const file = await write("{not json");
        const error = await loadWorkerConfig(file).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).message).toBe("config-invalid");
        expect(String((error as WorkerError).stack)).not.toContain(file);
    });
});
