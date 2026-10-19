import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }
export type FakeHandler = (request: RecordedRequest, response: http.ServerResponse) => void | Promise<void>;

/** A `node:http` stand-in for the BJJ-454 export API, bound to 127.0.0.1 on an ephemeral port. */
export class FakeExportServer {
    readonly requests: RecordedRequest[] = [];
    handler: FakeHandler = (_request, response) => { response.statusCode = 500; response.end(); };
    private readonly server: http.Server;
    private readonly sockets = new Set<import("node:net").Socket>();

    constructor() {
        this.server = http.createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
                const recorded = {
                    method: request.method ?? "", url: request.url ?? "", headers: request.headers,
                    body: Buffer.concat(chunks).toString("utf8"),
                };
                this.requests.push(recorded);
                void Promise.resolve(this.handler(recorded, response)).catch(() => response.destroy());
            });
        });
        this.server.on("connection", socket => { this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket)); });
    }

    async start(): Promise<string> {
        await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
        return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/internal/eformsign-backup/v1`;
    }

    async stop(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}

export function sendJson(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    response.writeHead(status, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)), ...headers });
    response.end(text);
}
