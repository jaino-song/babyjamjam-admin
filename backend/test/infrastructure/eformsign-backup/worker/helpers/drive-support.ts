import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DriveClient } from "infrastructure/eformsign-backup/worker/drive-client";
import { DriveTokenSource } from "infrastructure/eformsign-backup/worker/drive-auth";

import { FakeDriveServer } from "./fake-drive-server";
import { FakeOAuthServer, type FakeOAuthOptions } from "./fake-oauth-server";

/** The `drive` block of the worker config (BJJ-456 contract), all of it pointing at the 127.0.0.1 fakes. */
export interface DriveConfigBlock {
    clientFile: string;
    refreshTokenFile: string;
    tokenUrl: string;
    apiBaseUrl: string;
    uploadBaseUrl: string;
    rootFolderName?: string;
    chunkBytes?: number;
    requestTimeoutMs?: number;
}

export interface DriveHarness {
    oauth: FakeOAuthServer;
    drive: FakeDriveServer;
    /** Directory holding the 0600 secret files. */
    secretsDir: string;
    clientFile: string;
    refreshTokenFile: string;
    config: DriveConfigBlock;
    close(): Promise<void>;
}

export interface DriveHarnessOptions extends FakeOAuthOptions {
    chunkBytes?: number;
    requestTimeoutMs?: number;
    rootFolderName?: string;
}

async function writeSecret(file: string, content: string): Promise<void> {
    await fs.writeFile(file, content, { mode: 0o600 });
    await fs.chmod(file, 0o600);
}

/** Starts a fake OAuth server and a fake Drive server, and writes 0600 secret files for them into a fresh temp directory. */
export async function startDriveFakes(options: DriveHarnessOptions = {}): Promise<DriveHarness> {
    const oauth = new FakeOAuthServer(options);
    const drive = new FakeDriveServer(oauth);
    await oauth.listen();
    await drive.listen();
    const secretsDir = await fs.mkdtemp(path.join(tmpdir(), "bjj456-drive-"));
    const clientFile = path.join(secretsDir, "client.json");
    const refreshTokenFile = path.join(secretsDir, "refresh-token");
    await writeSecret(clientFile, `${JSON.stringify({ client_id: oauth.clientId, client_secret: oauth.clientSecret })}\n`);
    await writeSecret(refreshTokenFile, `${oauth.refreshToken}\n`);
    const config: DriveConfigBlock = {
        clientFile, refreshTokenFile, tokenUrl: oauth.tokenUrl, apiBaseUrl: drive.apiBaseUrl, uploadBaseUrl: drive.uploadBaseUrl,
        ...(options.rootFolderName ? { rootFolderName: options.rootFolderName } : {}),
        ...(options.chunkBytes ? { chunkBytes: options.chunkBytes } : {}),
        ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    };
    return {
        oauth, drive, secretsDir, clientFile, refreshTokenFile, config,
        close: async () => {
            await drive.close();
            await oauth.close();
            await fs.rm(secretsDir, { recursive: true, force: true });
        },
    };
}

export interface DriveClientOverrides {
    chunkBytes?: number;
    requestTimeoutMs?: number;
    now?: () => Date;
    fetchImpl?: typeof fetch;
}

/** A token source and a client wired to the harness; the token source shares `now`, so a fake clock moves both. */
export function makeDriveClient(harness: DriveHarness, overrides: DriveClientOverrides = {}): { client: DriveClient; tokens: DriveTokenSource } {
    const requestTimeoutMs = overrides.requestTimeoutMs ?? harness.config.requestTimeoutMs ?? 5000;
    const tokens = new DriveTokenSource({
        tokenUrl: harness.oauth.tokenUrl, clientId: harness.oauth.clientId, clientSecret: harness.oauth.clientSecret,
        refreshToken: harness.oauth.refreshToken, fetchImpl: overrides.fetchImpl, now: overrides.now ?? (() => new Date()), requestTimeoutMs,
    });
    const client = new DriveClient({
        apiBaseUrl: harness.drive.apiBaseUrl, uploadBaseUrl: harness.drive.uploadBaseUrl, tokens, fetchImpl: overrides.fetchImpl,
        requestTimeoutMs, chunkBytes: overrides.chunkBytes ?? harness.config.chunkBytes ?? 262144,
    });
    return { client, tokens };
}

/** A one-shot async iterable over `bytes` from `offset`, cut into pieces of `piece` bytes. */
export function bytesFrom(bytes: Buffer, piece = 64 * 1024): (offset: number) => AsyncIterable<Uint8Array> {
    return offset => (async function* () {
        for (let at = offset; at < bytes.length; at += piece) yield bytes.subarray(at, Math.min(at + piece, bytes.length));
    })();
}
