import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { WorkerError } from "domain/eformsign-backup/worker";
import { readSecretFile, readSecretJson } from "infrastructure/eformsign-backup/worker/secret-file";

const SECRET = "1//synthetic-refresh-token-0001";
const PATTERN = /^[A-Za-z0-9_\-/.]{20,512}$/;
const OPTIONS = { pattern: PATTERN, maxBytes: 600, reasonCode: "token-file-invalid" } as const;

describe("readSecretFile", () => {
    let base: string;
    beforeAll(async () => { base = await fs.mkdtemp(path.join(tmpdir(), "bjj456-secret-")); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });
    async function secretFile(name: string, content: string, mode = 0o600): Promise<string> {
        const file = path.join(base, name);
        await fs.writeFile(file, content, { mode });
        await fs.chmod(file, mode);
        return file;
    }

    it("should return the content, with or without one trailing newline", async () => {
        expect(await readSecretFile(await secretFile("ok1", SECRET), OPTIONS)).toBe(SECRET);
        expect(await readSecretFile(await secretFile("ok2", `${SECRET}\n`), OPTIONS)).toBe(SECRET);
    });

    it.each([
        ["mode 0644", SECRET, 0o644],
        ["mode 0640", SECRET, 0o640],
        ["mode 0400", SECRET, 0o400],
        ["pattern mismatch", `${SECRET} extra`, 0o600],
        ["too short", "short", 0o600],
        ["two newlines", `${SECRET}\n\n`, 0o600],
        ["oversize", "A".repeat(601), 0o600],
        ["empty", "", 0o600],
    ])("should reject %s with only the reason code", async (name, content, mode) => {
        const file = await secretFile(`bad-${name.replace(/\W/g, "")}`, content, mode);
        const error = await readSecretFile(file, OPTIONS).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).reasonCode).toBe("token-file-invalid");
        const dump = JSON.stringify(error, Object.getOwnPropertyNames(error));
        expect(dump).not.toContain(SECRET);
        expect(dump).not.toContain(base);
    });

    it("should hand back the caller's reason code, not a fixed one", async () => {
        const file = await secretFile("mode-reason", SECRET, 0o644);
        await expect(readSecretFile(file, { ...OPTIONS, reasonCode: "config-invalid" })).rejects.toMatchObject({ reasonCode: "config-invalid" });
    });

    it("should reject a file owned by another user", async () => {
        const file = await secretFile("other-owner", SECRET);
        expect(await readSecretFile(file, OPTIONS)).toBe(SECRET);
        const spy = jest.spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 1);
        try {
            await expect(readSecretFile(file, OPTIONS)).rejects.toMatchObject({ reasonCode: "token-file-invalid" });
        } finally {
            spy.mockRestore();
        }
    });

    it("should reject a symlink, a directory, a relative path and a missing file", async () => {
        const real = await secretFile("real", SECRET);
        await fs.symlink(real, path.join(base, "link"));
        await fs.mkdir(path.join(base, "dir"), { mode: 0o600 });
        for (const file of [path.join(base, "link"), path.join(base, "dir"), "relative-secret", path.join(base, "missing")]) {
            await expect(readSecretFile(file, OPTIONS)).rejects.toMatchObject({ reasonCode: "token-file-invalid" });
        }
    });
});

describe("readSecretJson", () => {
    const schema = z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }).strict();
    let base: string;
    beforeAll(async () => { base = await fs.mkdtemp(path.join(tmpdir(), "bjj456-secret-")); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });
    async function jsonFile(name: string, content: string, mode = 0o600): Promise<string> {
        const file = path.join(base, name);
        await fs.writeFile(file, content, { mode });
        await fs.chmod(file, mode);
        return file;
    }

    it("should parse a strict JSON secret", async () => {
        const file = await jsonFile("client", `${JSON.stringify({ client_id: "id-synthetic", client_secret: "secret-synthetic" })}\n`);
        expect(await readSecretJson(file, schema, 4096, "config-invalid")).toEqual({ client_id: "id-synthetic", client_secret: "secret-synthetic" });
    });

    it.each([
        ["not json", "client_id=abc"],
        ["wrong shape", JSON.stringify({ client_id: "id-synthetic" })],
        ["extra key", JSON.stringify({ client_id: "a", client_secret: "b", extra: "c" })],
        ["oversize", JSON.stringify({ client_id: "a", client_secret: "b".repeat(5000) })],
    ])("should reject %s without echoing the content", async (name, content) => {
        const file = await jsonFile(`bad-${name.replace(/\W/g, "")}`, content);
        const error = await readSecretJson(file, schema, 4096, "config-invalid").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).reasonCode).toBe("config-invalid");
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("client_id");
    });

    it("should refuse a loose mode and a symlink like any secret file", async () => {
        const loose = await jsonFile("loose", JSON.stringify({ client_id: "a", client_secret: "b" }), 0o644);
        await expect(readSecretJson(loose, schema, 4096, "config-invalid")).rejects.toMatchObject({ reasonCode: "config-invalid" });
        const real = await jsonFile("real", JSON.stringify({ client_id: "a", client_secret: "b" }));
        await fs.symlink(real, path.join(base, "link"));
        await expect(readSecretJson(path.join(base, "link"), schema, 4096, "config-invalid")).rejects.toMatchObject({ reasonCode: "config-invalid" });
    });
});
