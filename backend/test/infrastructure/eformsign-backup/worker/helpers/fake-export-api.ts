import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { EXPORT_POLICY_REVISION, EXPORT_SCOPE_REVISION } from "domain/eformsign-backup/export/constants";
import { artifactIdentity, metadataRevision } from "domain/eformsign-backup/source-evidence";

/** Synthetic stand-in for the BJJ-454 export API (contract 3): everything is served from memory, no customer data. */
export type FixtureClassification = "included" | "excluded_by_policy" | "unknown_template" | "inaccessible" | "policy_pending";
export interface FixtureArtifact { fileType: "document" | "audit_trail"; bytes: Buffer }
export interface FixtureDoc {
    documentId: string;
    classification?: FixtureClassification;
    statusType?: string;
    documentKind?: string | null;
    templateId?: string;
    artifacts?: FixtureArtifact[];
}

export type FaultRoute = "snapshot-post" | "snapshot-get" | "candidates" | "artifact";
export type Fault =
    | { kind: "status"; status: number; code: string; retryable?: boolean; retryAfterSeconds?: number }
    | { kind: "truncate" }
    | { kind: "stall"; until: Promise<void> }
    | { kind: "bytes"; bytes: Buffer }
    | { kind: "identity"; identity: string };
export interface FaultRule {
    route: FaultRoute;
    times: number;
    match?: (info: { documentId?: string; fileType?: string }) => boolean;
    fault: Fault;
}

interface SnapshotItem {
    ordinal: number;
    documentId: string;
    classification: FixtureClassification;
    statusType: string;
    documentKind: string | null;
    metadataRevision: string;
    artifacts: Array<{ fileType: "document" | "audit_trail"; artifactIdentity: string; sha256: string; byteSize: number; bytes: Buffer }>;
}
interface Snapshot {
    id: string;
    key: string;
    status: "building" | "ready" | "failed";
    items: SnapshotItem[];
    getsServed: number;
}

export interface FakeExportOptions {
    companyId: string;
    token: string;
    /** Candidates per page the server hands out, whatever `limit` asks for. */
    pageSize?: number;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export class FakeExportApi {
    readonly requests: Array<{ method: string; url: string }> = [];
    docs: FixtureDoc[] = [];
    /** First `building` answers of POST (`postStatus`) and of the following GETs before the snapshot turns `ready`. */
    postStatus: "ready" | "building" | "failed" = "ready";
    buildingGets = 0;
    /** `${documentId}/${fileType}` -> the (wrong) identity the candidates list announces for that artifact. */
    readonly identityOverrides = new Map<string, string>();
    private readonly faults: FaultRule[] = [];
    private readonly snapshots = new Map<string, Snapshot>();
    private readonly keys = new Map<string, string>();
    private readonly sockets = new Set<import("node:net").Socket>();
    private readonly server: http.Server;
    private readonly options: Required<FakeExportOptions>;

    constructor(options: FakeExportOptions) {
        this.options = { pageSize: 100, ...options };
        this.server = http.createServer((request, response) => {
            void this.handle(request, response).catch(() => response.destroy());
        });
        this.server.on("connection", (socket) => { this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket)); });
    }

    async start(): Promise<string> {
        await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
        return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/internal/eformsign-backup/v1`;
    }

    async stop(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }

    addFault(rule: FaultRule): void { this.faults.push({ ...rule }); }
    clearFaults(): void { this.faults.length = 0; }
    artifactRequests(): string[] { return this.requests.filter((request) => request.url.includes("/artifacts/")).map((request) => request.url); }
    snapshotCount(): number { return this.snapshots.size; }
    clearRequests(): void { this.requests.length = 0; }

    /** Identity of an artifact the way the real server computes it (source-evidence). */
    identityOf(documentId: string, fileType: "document" | "audit_trail", bytes: Buffer): string {
        return artifactIdentity({
            companyId: this.options.companyId, documentId, artifactKind: fileType === "audit_trail" ? "audit-trail" : "document",
            contentSha256: sha256(bytes), byteLength: bytes.byteLength,
        });
    }

    private takeFault(route: FaultRoute, info: { documentId?: string; fileType?: string }): Fault | null {
        for (const rule of this.faults) {
            if (rule.route !== route || rule.times <= 0 || (rule.match && !rule.match(info))) continue;
            rule.times -= 1;
            return rule.fault;
        }
        return null;
    }

    private createSnapshot(key: string): Snapshot {
        const known = this.keys.get(key);
        if (known) return this.snapshots.get(known)!;
        const items = [...this.docs].sort((a, b) => (a.documentId < b.documentId ? -1 : 1)).map((doc, index): SnapshotItem => {
            const classification = doc.classification ?? "included";
            const statusType = doc.statusType ?? "003";
            const documentKind = doc.documentKind === undefined ? "contract" : doc.documentKind;
            return {
                ordinal: index + 1,
                documentId: doc.documentId,
                classification,
                statusType,
                documentKind,
                metadataRevision: metadataRevision({
                    companyId: this.options.companyId, documentId: doc.documentId, documentKind, statusType, templateId: doc.templateId ?? null,
                }),
                artifacts: classification !== "included" ? [] : (doc.artifacts ?? []).map((artifact) => ({
                    fileType: artifact.fileType,
                    artifactIdentity: this.identityOverrides.get(`${doc.documentId}/${artifact.fileType}`) ?? this.identityOf(doc.documentId, artifact.fileType, artifact.bytes),
                    sha256: sha256(artifact.bytes),
                    byteSize: artifact.bytes.byteLength,
                    bytes: artifact.bytes,
                })),
            };
        });
        const snapshot: Snapshot = { id: randomUUID(), key, status: this.postStatus, items, getsServed: 0 };
        this.snapshots.set(snapshot.id, snapshot);
        this.keys.set(key, snapshot.id);
        return snapshot;
    }

    private view(snapshot: Snapshot): Record<string, unknown> {
        const tally = (classification: FixtureClassification) => snapshot.items.filter((item) => item.classification === classification).length;
        return {
            snapshotId: snapshot.id, status: snapshot.status, companyId: this.options.companyId,
            scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
            createdAt: "2026-10-19T00:00:00.000Z", readyAt: snapshot.status === "ready" ? "2026-10-19T00:00:00.000Z" : null,
            expiresAt: snapshot.status === "ready" ? "2026-10-20T00:00:00.000Z" : null,
            counts: {
                total: snapshot.items.length, inaccessible: tally("inaccessible"), unknownTemplate: tally("unknown_template"),
                policyPending: tally("policy_pending"), excludedByPolicy: tally("excluded_by_policy"), included: tally("included"),
            },
            coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false,
        };
    }

    private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const method = request.method ?? "GET";
        this.requests.push({ method, url: `${url.pathname}${url.search}` });
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const auth = request.headers["authorization"];
        if (auth !== `Bearer ${this.options.token}`) return this.error(response, 401, "UNAUTHORIZED");
        const path = url.pathname.replace("/internal/eformsign-backup/v1", "");

        if (method === "POST" && path === "/snapshots") {
            const key = request.headers["idempotency-key"];
            if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) return this.error(response, 400, "INVALID_REQUEST");
            if (await this.applyStatusFault("snapshot-post", {}, response)) return;
            return this.json(response, 202, this.view(this.createSnapshot(key)));
        }
        const snapshotMatch = /^\/snapshots\/([0-9a-f-]{36})(\/candidates|\/artifacts\/([0-9a-f]{64}))?$/.exec(path);
        const snapshot = snapshotMatch ? this.snapshots.get(snapshotMatch[1]!) : undefined;
        if (!snapshotMatch || !snapshot) return this.error(response, 404, "NOT_FOUND");

        if (method === "GET" && snapshotMatch[2] === undefined) {
            if (await this.applyStatusFault("snapshot-get", {}, response)) return;
            snapshot.getsServed += 1;
            if (snapshot.status === "building" && snapshot.getsServed > this.buildingGets) snapshot.status = "ready";
            return this.json(response, 200, this.view(snapshot));
        }
        if (method === "GET" && snapshotMatch[2] === "/candidates") {
            if (await this.applyStatusFault("candidates", {}, response)) return;
            if (snapshot.status === "building") return this.error(response, 409, "SNAPSHOT_NOT_READY", true);
            if (snapshot.status === "failed") return this.error(response, 409, "SNAPSHOT_FAILED");
            const after = url.searchParams.get("cursor") === null ? 0 : Number(Buffer.from(url.searchParams.get("cursor")!, "base64url").toString("utf8"));
            const page = snapshot.items.filter((item) => item.ordinal > after).slice(0, this.options.pageSize);
            const last = page[page.length - 1];
            const more = last !== undefined && snapshot.items.some((item) => item.ordinal > last.ordinal);
            return this.json(response, 200, {
                snapshotId: snapshot.id,
                items: page.map((item) => ({
                    ordinal: item.ordinal, documentId: item.documentId, classification: item.classification, reasons: [],
                    statusType: item.statusType, documentKind: item.documentKind, metadataRevision: item.metadataRevision,
                    artifacts: item.artifacts.map((artifact) => ({
                        fileType: artifact.fileType, artifactIdentity: artifact.artifactIdentity, sha256: artifact.sha256, byteSize: artifact.byteSize,
                    })),
                })),
                nextCursor: more && last ? Buffer.from(String(last.ordinal), "utf8").toString("base64url") : null,
            });
        }
        if (method === "GET" && snapshotMatch[2]?.startsWith("/artifacts/")) {
            const identity = snapshotMatch[3]!;
            let found: { item: SnapshotItem; artifact: SnapshotItem["artifacts"][number] } | undefined;
            for (const item of snapshot.items) {
                const artifact = item.artifacts.find((candidate) => candidate.artifactIdentity === identity);
                if (artifact) found = { item, artifact };
            }
            if (!found) return this.error(response, 404, "NOT_FOUND");
            const info = { documentId: found.item.documentId, fileType: found.artifact.fileType };
            const fault = this.takeFault("artifact", info);
            let body = found.artifact.bytes;
            let announcedIdentity = identity;
            if (fault?.kind === "status") return this.error(response, fault.status, fault.code, fault.retryable, fault.retryAfterSeconds);
            if (fault?.kind === "bytes") body = fault.bytes;
            if (fault?.kind === "identity") announcedIdentity = fault.identity;
            if (fault?.kind === "stall") await fault.until;
            response.writeHead(200, {
                "Content-Type": "application/pdf", "Content-Length": String(fault?.kind === "truncate" ? body.length : found.artifact.bytes.length),
                "X-Artifact-Identity": announcedIdentity, "X-Content-Sha256": found.artifact.sha256, "Cache-Control": "no-store",
            });
            if (fault?.kind === "truncate") {
                response.write(body.subarray(0, Math.floor(body.length / 2)));
                setTimeout(() => response.destroy(), 20);
                return;
            }
            response.end(body);
            return;
        }
        return this.error(response, 404, "NOT_FOUND");
    }

    private async applyStatusFault(route: FaultRoute, info: { documentId?: string }, response: http.ServerResponse): Promise<boolean> {
        const fault = this.takeFault(route, info);
        if (!fault) return false;
        if (fault.kind === "status") { this.error(response, fault.status, fault.code, fault.retryable, fault.retryAfterSeconds); return true; }
        if (fault.kind === "stall") await fault.until;
        return false;
    }

    private json(response: http.ServerResponse, status: number, body: unknown): void {
        const text = JSON.stringify(body);
        response.writeHead(status, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)), "Cache-Control": "no-store" });
        response.end(text);
    }

    private error(response: http.ServerResponse, status: number, code: string, retryable = false, retryAfterSeconds?: number): void {
        this.json(response, status, { code, retryable, requestId: randomUUID(), ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });
    }
}
