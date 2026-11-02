import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { FakeOAuthServer } from "./fake-oauth-server";

export const FAKE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const API_PREFIX = "/api";
const UPLOAD_PREFIX = "/up";
const DEFAULT_FIELDS = ["id", "name", "mimeType"];

export type DriveRoute = "generateIds" | "create" | "get" | "download" | "list" | "about" | "uploadStart" | "uploadPut" | "uploadProbe";

/** What a fault's `match` sees of a request: never a body. `offset` is the first byte of an `uploadPut` chunk. */
export interface RouteRequest {
    route: DriveRoute;
    method: string;
    path: string;
    query: URLSearchParams;
    id: string | null;
    offset: number | null;
}

export type FaultAction =
    | { type: "status"; status: number; reason?: string; retryAfter?: number | string }
    | { type: "lostResponse" }
    | { type: "dropRequest" }
    | { type: "expireSession"; status: 404 | 410 }
    | { type: "dropRangeHeader" }
    | { type: "omitSha256" }
    | { type: "canary"; text: string }
    | { type: "stall"; ms: number };

/**
 * The fault actions.
 * - `status`: answer with that Google-style error without handling the request (`retryAfter` becomes `Retry-After`).
 * - `lostResponse`: handle the request, apply its mutation, then destroy the socket without answering.
 * - `dropRequest`: destroy the socket without handling the request.
 * - `expireSession`: forget the upload session and answer 404 (or 410); only meaningful on `uploadPut` / `uploadProbe`.
 * - `dropRangeHeader`: a 308 answer loses its `Range` header AND the server forgets the bytes it held (it holds nothing),
 *   so a client that resumes at its old offset is refused; only meaningful on `uploadPut` / `uploadProbe`.
 * - `omitSha256`: strip `sha256Checksum` from the answer.
 * - `canary`: add the text to the answer's JSON body, its `WWW-Authenticate` header and its `Location` query.
 * - `stall`: hold the request for `ms` before handling it; a client that gave up in the meantime is not served.
 */
export const driveFaults = {
    status: (status: number, reason?: string, retryAfter?: number | string): FaultAction => ({ type: "status", status, reason, retryAfter }),
    lostResponse: (): FaultAction => ({ type: "lostResponse" }),
    dropRequest: (): FaultAction => ({ type: "dropRequest" }),
    expireSession: (status: 404 | 410 = 404): FaultAction => ({ type: "expireSession", status }),
    dropRangeHeader: (): FaultAction => ({ type: "dropRangeHeader" }),
    omitSha256: (): FaultAction => ({ type: "omitSha256" }),
    canary: (text: string): FaultAction => ({ type: "canary", text }),
    stall: (ms: number): FaultAction => ({ type: "stall", ms }),
};

export interface FaultRule {
    /** `"*"` matches every route. */
    route: DriveRoute | "*";
    /** How many times the rule may apply; unlimited when absent. */
    times?: number;
    match?: (request: RouteRequest) => boolean;
    action: FaultAction;
}

export interface InstalledFault extends FaultRule { hits: number }

export interface FakeNode {
    id: string;
    name: string;
    mimeType: string;
    parents: string[];
    appProperties: Record<string, string>;
    bytes: Buffer | null;
    trashed: boolean;
}

interface Session {
    id: string;
    meta: FakeNode;
    total: number;
    fields: string | null;
    bytes: Buffer;
    finalId: string | null;
}

interface Reply {
    status: number;
    headers: Record<string, string>;
    json?: unknown;
    body?: Buffer;
    session?: Session;
}

function sha256Of(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function errorReply(status: number, reason: string, retryAfter?: number | string): Reply {
    return {
        status,
        headers: retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
        json: { error: { code: status, message: "fake error", errors: [{ domain: "global", reason, message: "fake error" }], status: "FAKE" } },
    };
}

function parseFields(fields: string | null): string[] {
    return fields === null ? DEFAULT_FIELDS : fields.split(",").map(name => name.trim()).filter(name => name !== "");
}

/**
 * A `node:http` stand-in for Google Drive v3 (the calls of the BJJ-456 client only), bound to 127.0.0.1 on an ephemeral port.
 * `apiBaseUrl` and `uploadBaseUrl` share the server but not the path prefix, so a client that mixes them up gets a 404.
 * Every id, name and byte is synthetic. Tokens are checked against the `FakeOAuthServer` it was built with.
 */
export class FakeDriveServer {
    /** The id `root` stands for (the user's My Drive). */
    readonly myDriveId = "FakeMyDriveRootId000001";
    permissionId = "99999999999999999999";
    /** Largest page the server returns, whatever `pageSize` asks. */
    pageSizeCap = 1000;
    /** Reject creates whose id did not come from `generateIds`, as Drive does. */
    strictIds = true;

    creates = 0;
    sessionsStarted = 0;
    uploadsCompleted = 0;
    bytesReceived = 0;
    listCalls = 0;
    downloads = 0;
    /** Method and path of every request, in order; never a body, a query or a header. */
    readonly requests: Array<{ method: string; path: string }> = [];
    readonly faults: InstalledFault[] = [];

    private readonly nodeMap = new Map<string, FakeNode>();
    private readonly sessions = new Map<string, Session>();
    private readonly generated = new Set<string>();
    private idCounter = 0;
    private sessionCounter = 0;
    private quotaExceeded = false;
    private readonly server: http.Server;
    private readonly sockets = new Set<import("node:net").Socket>();
    private port = 0;

    constructor(private readonly oauth: FakeOAuthServer) {
        this.nodeMap.set(this.myDriveId, {
            id: this.myDriveId, name: "My Drive", mimeType: FAKE_FOLDER_MIME_TYPE, parents: [], appProperties: {}, bytes: null, trashed: false,
        });
        this.server = http.createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
                void this.handle(request, response, Buffer.concat(chunks)).catch(() => response.destroy());
            });
        });
        this.server.on("connection", socket => { this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket)); });
    }

    get apiBaseUrl(): string { return `http://127.0.0.1:${this.port}${API_PREFIX}`; }
    get uploadBaseUrl(): string { return `http://127.0.0.1:${this.port}${UPLOAD_PREFIX}`; }

    async listen(): Promise<void> {
        await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
        this.port = (this.server.address() as AddressInfo).port;
    }

    async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    // ---- faults ----------------------------------------------------------------------------------------------

    addFault(rule: FaultRule): InstalledFault {
        const fault: InstalledFault = { ...rule, hits: 0 };
        this.faults.push(fault);
        return fault;
    }

    clearFaults(): void { this.faults.length = 0; }

    // ---- mutators --------------------------------------------------------------------------------------------

    trash(id: string): void { this.must(id).trashed = true; }
    rename(id: string, name: string): void { this.must(id).name = name; }
    move(id: string, parentId: string): void { this.must(id).parents = [parentId]; }
    /** The stored bytes change (first byte flipped, or one byte added to an empty file); `sha256Checksum` follows the bytes. */
    corrupt(id: string): void {
        const node = this.must(id);
        node.bytes = node.bytes && node.bytes.length > 0
            ? Buffer.concat([Buffer.from([node.bytes[0]! ^ 0xff]), node.bytes.subarray(1)])
            : Buffer.from([0xff]);
    }
    setQuotaExceeded(on: boolean): void { this.quotaExceeded = on; }
    /** The user revoked the app: the refresh token is dead and every access token is refused. */
    revokeAccess(): void { this.oauth.revoke(); }

    // ---- inspection ------------------------------------------------------------------------------------------

    node(id: string): FakeNode | undefined { return this.nodeMap.get(id); }
    nodes(): FakeNode[] { return [...this.nodeMap.values()]; }
    children(parentId: string): FakeNode[] { return this.nodes().filter(node => node.parents.includes(parentId)); }
    bytesOf(id: string): Buffer | null { return this.nodeMap.get(id)?.bytes ?? null; }
    fileCount(): number { return this.nodes().filter(node => node.bytes !== null).length; }
    /** Puts a node in place without any request (an id the client has not generated is fine here). */
    seed(node: Partial<FakeNode> & { id: string; name: string }): FakeNode {
        const full: FakeNode = {
            mimeType: FAKE_FOLDER_MIME_TYPE, parents: [this.myDriveId], appProperties: {}, bytes: null, trashed: false, ...node,
        };
        this.nodeMap.set(full.id, full);
        return full;
    }

    private must(id: string): FakeNode {
        const node = this.nodeMap.get(id);
        if (!node) throw new Error(`fake drive: no node ${id}`);
        return node;
    }

    // ---- request handling ------------------------------------------------------------------------------------

    private classify(request: http.IncomingMessage, url: URL): RouteRequest | null {
        const method = request.method ?? "";
        const path = url.pathname;
        const base = { method, path, query: url.searchParams, id: null as string | null, offset: null as number | null };
        const api = path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : null;
        if (api !== null) {
            if (method === "GET" && api === "/drive/v3/files/generateIds") return { ...base, route: "generateIds" };
            if (method === "GET" && api === "/drive/v3/about") return { ...base, route: "about" };
            if (method === "POST" && api === "/drive/v3/files") return { ...base, route: "create" };
            if (method === "GET" && api === "/drive/v3/files") return { ...base, route: "list" };
            const single = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(api);
            if (method === "GET" && single) {
                return { ...base, route: url.searchParams.get("alt") === "media" ? "download" : "get", id: single[1]! };
            }
            return null;
        }
        if (path === `${UPLOAD_PREFIX}/upload/drive/v3/files`) {
            if (method === "POST" && url.searchParams.get("uploadType") === "resumable") return { ...base, route: "uploadStart" };
            if (method === "PUT" && url.searchParams.has("upload_id")) {
                const range = request.headers["content-range"] ?? "";
                const chunk = /^bytes (\d+)-\d+\/\d+$/.exec(range);
                return chunk
                    ? { ...base, route: "uploadPut", id: url.searchParams.get("upload_id"), offset: Number(chunk[1]) }
                    : { ...base, route: "uploadProbe", id: url.searchParams.get("upload_id") };
            }
        }
        return null;
    }

    private takeFault(route: RouteRequest, types: ReadonlyArray<FaultAction["type"]>, applies: (action: FaultAction) => boolean = () => true): InstalledFault[] {
        const taken: InstalledFault[] = [];
        for (const fault of this.faults) {
            if (!types.includes(fault.action.type)) continue;
            if (fault.route !== "*" && fault.route !== route.route) continue;
            if (fault.times !== undefined && fault.hits >= fault.times) continue;
            if (fault.match && !fault.match(route)) continue;
            if (!applies(fault.action)) continue;
            taken.push(fault);
        }
        return taken;
    }

    private async handle(request: http.IncomingMessage, response: http.ServerResponse, body: Buffer): Promise<void> {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        this.requests.push({ method: request.method ?? "", path: url.pathname });
        const route = this.classify(request, url);
        if (!route) { this.write(response, errorReply(404, "notFound")); return; }

        let reply: Reply | null = null;
        const bearer = /^Bearer (\S+)$/.exec(String(request.headers["authorization"] ?? ""));
        if (!bearer || !this.oauth.accepts(bearer[1]!)) {
            reply = errorReply(401, "authError");
            reply.headers["WWW-Authenticate"] = 'Bearer realm="fake"';
        }

        if (!reply) {
            const dropped = this.takeFault(route, ["dropRequest"])[0];
            if (dropped) { dropped.hits += 1; request.socket.destroy(); return; }
            const statusFault = this.takeFault(route, ["status"])[0];
            if (statusFault) {
                statusFault.hits += 1;
                const action = statusFault.action as Extract<FaultAction, { type: "status" }>;
                reply = errorReply(action.status, action.reason ?? "backendError", action.retryAfter);
            }
        }
        if (!reply) {
            const stalls = this.takeFault(route, ["stall"]);
            for (const stall of stalls) {
                stall.hits += 1;
                await new Promise(resolve => setTimeout(resolve, (stall.action as Extract<FaultAction, { type: "stall" }>).ms));
            }
            if (stalls.length > 0 && request.socket.destroyed) return;
        }
        if (!reply) {
            const expire = this.takeFault(route, ["expireSession"], () => route.route === "uploadPut" || route.route === "uploadProbe")[0];
            if (expire) {
                expire.hits += 1;
                this.sessions.delete(route.id ?? "");
                reply = errorReply((expire.action as Extract<FaultAction, { type: "expireSession" }>).status, "notFound");
            }
        }
        if (!reply) reply = this.dispatch(route, request, body);

        // Post-processing faults: they reshape the answer the request already earned.
        for (const fault of this.takeFault(route, ["dropRangeHeader"], () => reply!.status === 308 && reply!.session !== undefined)) {
            fault.hits += 1;
            delete reply.headers["Range"];
            reply.session!.bytes = Buffer.alloc(0);
        }
        for (const fault of this.takeFault(route, ["omitSha256"], () => JSON.stringify(reply!.json ?? "").includes("sha256Checksum"))) {
            fault.hits += 1;
            reply.json = JSON.parse(JSON.stringify(reply.json, (key, value: unknown) => (key === "sha256Checksum" ? undefined : value)));
        }
        for (const fault of this.takeFault(route, ["canary"])) {
            fault.hits += 1;
            const text = (fault.action as Extract<FaultAction, { type: "canary" }>).text;
            reply.headers["WWW-Authenticate"] = `Bearer realm="${text}"`;
            if (reply.headers["Location"]) reply.headers["Location"] += `&canary=${encodeURIComponent(text)}`;
            if (reply.json && typeof reply.json === "object") {
                const json = reply.json as Record<string, unknown>;
                json["canary"] = text;
                const error = json["error"] as { message?: string; errors?: Array<{ message?: string }> } | undefined;
                if (error) { error.message = text; for (const entry of error.errors ?? []) entry.message = text; }
            }
        }
        const lost = this.takeFault(route, ["lostResponse"])[0];
        if (lost) { lost.hits += 1; request.socket.destroy(); return; }
        this.write(response, reply);
    }

    private write(response: http.ServerResponse, reply: Reply): void {
        const headers: Record<string, string> = { ...reply.headers };
        let payload: Buffer;
        if (reply.json !== undefined) {
            headers["Content-Type"] = "application/json; charset=UTF-8";
            payload = Buffer.from(JSON.stringify(reply.json));
        } else {
            payload = reply.body ?? Buffer.alloc(0);
        }
        headers["Content-Length"] = String(payload.length);
        response.writeHead(reply.status, headers);
        response.end(payload);
    }

    private dispatch(route: RouteRequest, request: http.IncomingMessage, body: Buffer): Reply {
        switch (route.route) {
            case "generateIds": return this.generateIds(route);
            case "about": return { status: 200, headers: {}, json: { user: { permissionId: this.permissionId } } };
            case "create": return this.create(route, body);
            case "list": return this.list(route);
            case "get": return this.get(route);
            case "download": return this.download(route);
            case "uploadStart": return this.uploadStart(route, request, body);
            case "uploadPut":
            case "uploadProbe": return this.uploadPut(route, request, body);
        }
    }

    private project(node: FakeNode, fields: string | null): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const name of parseFields(fields)) {
            switch (name) {
                case "id": out["id"] = node.id; break;
                case "name": out["name"] = node.name; break;
                case "mimeType": out["mimeType"] = node.mimeType; break;
                case "parents": out["parents"] = node.parents; break;
                case "trashed": out["trashed"] = node.trashed; break;
                case "appProperties": if (Object.keys(node.appProperties).length > 0) out["appProperties"] = node.appProperties; break;
                case "size": if (node.bytes) out["size"] = String(node.bytes.length); break;
                case "sha256Checksum": if (node.bytes) out["sha256Checksum"] = sha256Of(node.bytes); break;
                default: break;
            }
        }
        return out;
    }

    private generateIds(route: RouteRequest): Reply {
        const count = Number(route.query.get("count") ?? "10");
        if (!Number.isInteger(count) || count < 1 || count > 1000) return errorReply(400, "invalid");
        const ids: string[] = [];
        for (let index = 0; index < count; index += 1) {
            this.idCounter += 1;
            const id = `FakeGeneratedId_${String(this.idCounter).padStart(12, "0")}`;
            this.generated.add(id);
            ids.push(id);
        }
        return { status: 200, headers: {}, json: { kind: "drive#generatedIds", space: "drive", ids } };
    }

    /** The checks a create shares with the start of a resumable upload. Null means the metadata is acceptable. */
    private checkNewNode(meta: unknown): { error: Reply } | { node: FakeNode } {
        if (typeof meta !== "object" || meta === null) return { error: errorReply(400, "parseError") };
        const input = meta as { id?: unknown; name?: unknown; parents?: unknown; mimeType?: unknown; appProperties?: unknown };
        if (typeof input.name !== "string" || typeof input.mimeType !== "string"
            || !Array.isArray(input.parents) || input.parents.length !== 1 || typeof input.parents[0] !== "string") {
            return { error: errorReply(400, "invalid") };
        }
        const id = typeof input.id === "string" ? input.id : null;
        if (id === null) return { error: errorReply(400, "invalid") };
        if (this.nodeMap.has(id)) return { error: errorReply(409, "duplicate") };
        if (this.strictIds && !this.generated.has(id)) return { error: errorReply(400, "invalid") };
        const parent = this.nodeMap.get(input.parents[0] === "root" ? this.myDriveId : input.parents[0]);
        if (!parent) return { error: errorReply(404, "notFound") };
        if (parent.mimeType !== FAKE_FOLDER_MIME_TYPE) return { error: errorReply(400, "invalid") };
        const appProperties = typeof input.appProperties === "object" && input.appProperties !== null
            ? input.appProperties as Record<string, string> : {};
        return { node: { id, name: input.name, mimeType: input.mimeType, parents: [parent.id], appProperties, bytes: null, trashed: false } };
    }

    private create(route: RouteRequest, body: Buffer): Reply {
        let meta: unknown;
        try { meta = JSON.parse(body.toString("utf8")); } catch { return errorReply(400, "parseError"); }
        if (this.quotaExceeded) return errorReply(403, "storageQuotaExceeded");
        const checked = this.checkNewNode(meta);
        if ("error" in checked) return checked.error;
        if (checked.node.mimeType !== FAKE_FOLDER_MIME_TYPE) checked.node.bytes = Buffer.alloc(0);
        this.nodeMap.set(checked.node.id, checked.node);
        this.creates += 1;
        return { status: 200, headers: {}, json: this.project(checked.node, route.query.get("fields")) };
    }

    private get(route: RouteRequest): Reply {
        const id = route.id === "root" ? this.myDriveId : route.id!;
        const node = this.nodeMap.get(id);
        return node ? { status: 200, headers: {}, json: this.project(node, route.query.get("fields")) } : errorReply(404, "notFound");
    }

    private download(route: RouteRequest): Reply {
        const node = this.nodeMap.get(route.id === "root" ? this.myDriveId : route.id!);
        if (!node) return errorReply(404, "notFound");
        if (node.bytes === null) return errorReply(403, "fileNotDownloadable");
        this.downloads += 1;
        return { status: 200, headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(node.bytes) };
    }

    private list(route: RouteRequest): Reply {
        this.listCalls += 1;
        const filters = this.parseQuery(route.query.get("q") ?? "");
        if (!filters) return errorReply(400, "invalid");
        const matching = this.nodes().filter(node => node.id !== this.myDriveId && filters.every(filter => filter(node)));
        const size = Math.min(Number(route.query.get("pageSize") ?? "100") || 100, this.pageSizeCap);
        const token = route.query.get("pageToken");
        let start = 0;
        if (token !== null) {
            const parsed = /^page-(\d+)$/.exec(token);
            if (!parsed) return errorReply(400, "invalid");
            start = Number(parsed[1]);
        }
        const page = matching.slice(start, start + size);
        const fields = route.query.get("fields");
        const inner = fields === null ? null : (/files\(([^)]*)\)/.exec(fields)?.[1] ?? null);
        const json: Record<string, unknown> = { kind: "drive#fileList", incompleteSearch: false, files: page.map(node => this.project(node, inner)) };
        if (start + size < matching.length) json["nextPageToken"] = `page-${start + size}`;
        return { status: 200, headers: {}, json };
    }

    /** The query subset the client sends; anything else is a 400 so a client drifting from it fails loudly. */
    private parseQuery(q: string): Array<(node: FakeNode) => boolean> | null {
        const filters: Array<(node: FakeNode) => boolean> = [];
        let rest = q.trim();
        const clauses: Array<[RegExp, (match: RegExpExecArray) => (node: FakeNode) => boolean]> = [
            [/^'([A-Za-z0-9_-]+)' in parents/, m => node => node.parents.includes(m[1] === "root" ? this.myDriveId : m[1]!)],
            [/^trashed\s*=\s*(true|false)/, m => node => node.trashed === (m[1] === "true")],
            [/^mimeType\s*=\s*'([^']+)'/, m => node => node.mimeType === m[1]],
            [/^appProperties has \{ key='([^']*)' and value='([^']*)' \}/, m => node => node.appProperties[m[1]!] === m[2]],
        ];
        while (rest !== "") {
            let matched = false;
            for (const [pattern, build] of clauses) {
                const m = pattern.exec(rest);
                if (!m) continue;
                filters.push(build(m));
                rest = rest.slice(m[0].length);
                matched = true;
                break;
            }
            if (!matched) return null;
            if (rest === "") break;
            const joiner = /^\s+and\s+/.exec(rest);
            if (!joiner) return null;
            rest = rest.slice(joiner[0].length);
        }
        return filters;
    }

    private uploadStart(route: RouteRequest, request: http.IncomingMessage, body: Buffer): Reply {
        let meta: unknown;
        try { meta = JSON.parse(body.toString("utf8")); } catch { return errorReply(400, "parseError"); }
        if (this.quotaExceeded) return errorReply(403, "storageQuotaExceeded");
        const checked = this.checkNewNode(meta);
        if ("error" in checked) return checked.error;
        const declared = Number(request.headers["x-upload-content-length"]);
        if (!Number.isSafeInteger(declared) || declared < 0) return errorReply(400, "invalid");
        this.sessionCounter += 1;
        this.sessionsStarted += 1;
        const id = `session-${String(this.sessionCounter).padStart(6, "0")}`;
        this.sessions.set(id, { id, meta: checked.node, total: declared, fields: route.query.get("fields"), bytes: Buffer.alloc(0), finalId: null });
        return {
            status: 200,
            headers: { Location: `http://127.0.0.1:${this.port}${UPLOAD_PREFIX}/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` },
        };
    }

    private uploadPut(route: RouteRequest, request: http.IncomingMessage, body: Buffer): Reply {
        const session = this.sessions.get(route.id ?? "");
        if (!session) return errorReply(404, "notFound");
        const range = String(request.headers["content-range"] ?? "");
        const probe = /^bytes \*\/(\d+)$/.exec(range);
        const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
        if (!probe && !chunk) return errorReply(400, "invalid");
        const declaredTotal = Number((probe ?? chunk)![probe ? 1 : 3]);
        if (declaredTotal !== session.total) return errorReply(400, "invalid");
        if (session.finalId !== null) return this.finished(session);
        if (chunk) {
            const start = Number(chunk[1]);
            const end = Number(chunk[2]);
            if (end - start + 1 !== body.length) return errorReply(400, "invalid");
            if (start !== session.bytes.length) return this.incomplete(session);
            session.bytes = Buffer.concat([session.bytes, body]);
            this.bytesReceived += body.length;
        }
        if (session.bytes.length === session.total && (chunk || session.total === 0)) return this.finalize(session);
        return this.incomplete(session);
    }

    private incomplete(session: Session): Reply {
        const headers: Record<string, string> = {};
        if (session.bytes.length > 0) headers["Range"] = `bytes=0-${session.bytes.length - 1}`;
        return { status: 308, headers, session };
    }

    private finalize(session: Session): Reply {
        if (this.quotaExceeded) return errorReply(403, "storageQuotaExceeded");
        if (this.nodeMap.has(session.meta.id)) return errorReply(409, "duplicate");
        const node: FakeNode = { ...session.meta, bytes: Buffer.from(session.bytes) };
        this.nodeMap.set(node.id, node);
        session.finalId = node.id;
        this.creates += 1;
        this.uploadsCompleted += 1;
        return this.finished(session);
    }

    private finished(session: Session): Reply {
        return { status: 200, headers: {}, json: this.project(this.must(session.finalId!), session.fields) };
    }
}
