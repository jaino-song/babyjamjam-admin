import { MessageEvent } from "@nestjs/common";
import { execFile } from "node:child_process";
import { createServer, connect, Server as NetServer, Socket, AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import type { Subscription } from "rxjs";

import { EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "interface/controllers/realtime.controller";
import { deriveRealtimeCursorKey } from "./entity-change-cursor-codec";
import { ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

/**
 * Destructive continuity scenarios against real Valkey SERVERS that this spec starts, restarts, fills,
 * flushes, replicates and promotes itself (Docker, one disposable container per scenario, loopback-only
 * random ports, everything removed afterwards). Opt in with REALTIME_TEST_DOCKER=1. It never talks to a
 * Valkey it did not start, so a developer's or host's own instance is out of reach by construction.
 *
 * What each scenario asserts: a cursor taken before the damage is NOT honoured (neither by a transport that
 * was listening through it nor by a brand-new one), an active reader is told with a `reset`, nothing of the
 * lost history is delivered, and the stream path is usable again afterwards (the positive direction).
 */
const ENABLED = process.env["REALTIME_TEST_DOCKER"] === "1";
const IMAGE = process.env["REALTIME_TEST_VALKEY_IMAGE"] ?? "valkey/valkey:8-alpine";
const PREFIX = process.env["REALTIME_TEST_CONTAINER_PREFIX"] ?? "rt-valkey-test-";

type Received = Array<MessageEvent & { id?: string }>;

const CURSOR_KEY = deriveRealtimeCursorKey("realtime-restore-test-secret");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const changes = (received: Received) => received.filter((e) => e.type === "entity-changed");
const resets = (received: Received) => received.filter((e) => e.type === "reset");
const incarnationOf = (position: string) => position.split("@")[1] as string;

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await pause(25);
    }
}

function docker(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile("docker", args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`docker ${args.join(" ")} failed: ${stderr || error.message}`));
            else resolve(stdout.trim());
        });
    });
}

function freeLoopbackPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address() as AddressInfo;
            probe.close(() => resolve(port));
        });
    });
}

interface Server {
    name: string;
    port: number;
    url: string;
}

const containers: string[] = [];
const networks: string[] = [];
const volumes: string[] = [];
const proxies: NetServer[] = [];

/** One disposable Valkey: container name `<prefix>…`, published on a random free loopback port that survives restarts. */
async function startServer(label: string, args: string[] = [], network?: string): Promise<Server> {
    const name = `${PREFIX}${label}-${randomBytes(3).toString("hex")}`;
    const port = await freeLoopbackPort();
    // A named volume, because the image declares none: the data directory has to be reachable from a second
    // container while this one is stopped (the older-files scenarios swap files in then).
    volumes.push(`${name}-data`);
    await docker(
        "run", "-d", "--name", name, "-v", `${name}-data:/data`, "-p", `127.0.0.1:${port}:6379`, ...(network ? ["--network", network] : []),
        IMAGE, "valkey-server", "--save", "", "--appendonly", "no", ...args,
    );
    containers.push(name);
    const server = { name, port, url: `redis://127.0.0.1:${port}` };
    await waitReady(server);
    return server;
}

async function waitReady(server: Server): Promise<void> {
    await waitFor(async () => {
        const probe = new Redis(server.url, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null });
        probe.on("error", () => undefined);
        try {
            await probe.connect();
            return (await probe.ping()) === "PONG";
        } catch {
            return false;
        } finally {
            probe.disconnect();
        }
    }, `${server.name} to accept connections`, 30_000);
}

/** SHUTDOWN NOSAVE through the server, wait for the container to exit, start it again on the same port. */
async function crashAndRestart(server: Server, beforeStart?: () => Promise<void>): Promise<void> {
    const admin = new Redis(server.url, { maxRetriesPerRequest: 0 });
    admin.on("error", () => undefined);
    try {
        await admin.call("SHUTDOWN", "NOSAVE");
    } catch {
        // the connection closes because the server went away
    } finally {
        admin.disconnect();
    }
    await docker("wait", server.name);
    if (beforeStart) await beforeStart();
    await docker("start", server.name);
    await waitReady(server);
}

function instance(url: string, streamKey: string) {
    const bus = new EntityChangeEventBus(10);
    const transport = new ValkeyEntityChangeTransport(bus, {
        url,
        streamKey,
        cursorKey: CURSOR_KEY,
        retryDelayMs: 50,
        maxRetryDelayMs: 200,
        blockMs: 500,
    });
    const controller = new RealtimeController(bus, transport);
    const subscriptions: Subscription[] = [];
    const subscribe = (branchId: string, since?: string) => {
        const received: Received = [];
        const token = since === undefined ? undefined : transport.cursors.encode(since);
        subscriptions.push(controller.events({ branchId }, token).subscribe((e) => received.push(e)));
        return received;
    };
    const cursorOf = (id: string | undefined) => (id === undefined ? undefined : transport.cursors.decode(id));
    const destroy = () => {
        subscriptions.forEach((s) => s.unsubscribe());
        transport.onModuleDestroy();
    };
    return { bus, transport, controller, subscribe, cursorOf, destroy };
}
type Instance = ReturnType<typeof instance>;

async function reconnect(on: Instance, branchId: string, token: string): Promise<Received> {
    const received: Received = [];
    const sub = on.controller.events({ branchId }, token).subscribe((e) => received.push(e));
    await waitFor(() => received.length >= 1, "ready");
    await pause(150);
    sub.unsubscribe();
    return received;
}

/** Everything a scenario needs: two live transports on one server, a token for branch-a and a hint it does not cover. */
interface History {
    streamKey: string;
    a: Instance;
    b: Instance;
    /** Subscribed on `b` before the damage (an active reader). */
    live: Received;
    token: string;
}

async function writeHistory(url: string, streamKey: string): Promise<History> {
    const a = instance(url, streamKey);
    const b = instance(url, streamKey);
    await waitFor(() => a.transport.activeMode === "valkey" && b.transport.activeMode === "valkey", "both transports on the stream");
    const live = b.subscribe("branch-a");
    a.bus.emit({ branchId: "branch-a", kind: "client" });
    await waitFor(() => changes(live).length === 1, "first batch");
    const token = changes(live)[0]?.id as string;
    return { streamKey, a, b, live, token };
}

async function publishHint(h: History): Promise<void> {
    await pause(40);
    const before = h.b.transport.position();
    h.a.bus.emit({ branchId: "branch-a", kind: "document" }); // the hint a resume must not lose
    await waitFor(() => h.b.transport.position() !== before, "document hint delivered");
}

/**
 * After the damage: the old token must be refused by a transport that lived through it and by a brand-new one,
 * an active reader must be told, and the system must be usable again with tokens that resume.
 */
async function expectRecovered(url: string, h: History, seen: number): Promise<void> {
    const fresh = instance(url, h.streamKey);
    try {
        await waitFor(() => fresh.transport.activeMode === "valkey", "a new transport on the stream", 30_000);
        const internal = h.b.cursorOf(h.token) as string;

        expect(await fresh.transport.replayAfter(internal)).toEqual({ honoured: false });
        const received = await reconnect(fresh, "branch-a", h.token);
        expect([received[0]?.type, received[0]?.data]).toEqual(["ready", { resumed: false }]);
        expect(changes(received)).toEqual([]);

        // The transport that was listening through the damage: told with a reset, and it refuses too.
        await waitFor(() => h.b.transport.activeMode === "valkey", "the old transport back on the stream", 30_000);
        await waitFor(() => resets(h.live.slice(seen)).length >= 1, "a reset for the active reader");
        expect(changes(h.live.slice(seen))).toEqual([]); // nothing of the lost history was delivered
        expect(await h.b.transport.replayAfter(internal)).toEqual({ honoured: false });

        // The positive direction: a token issued from here on resumes, and recovery does not repeat.
        const onFresh = fresh.subscribe("branch-a");
        fresh.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onFresh).length === 1, "a batch after the recovery");
        const token = changes(onFresh)[0]?.id as string;
        fresh.bus.emit({ branchId: "branch-a", kind: "call" });
        await waitFor(() => changes(onFresh).length === 2, "a second batch");
        const resumed = await reconnect(fresh, "branch-a", token);
        expect(resumed[0]?.data).toEqual({ resumed: true });
        expect(changes(resumed).map((e) => e.data)).toEqual([{ entities: ["call"] }]);
        const resetCount = resets(h.live).length;
        await pause(1300);
        expect(resets(h.live)).toHaveLength(resetCount);
    } finally {
        fresh.destroy();
    }
}

const describeWithDocker = ENABLED ? describe : describe.skip;
if (!ENABLED) {
    console.warn("valkey-entity-change-transport restore tests skipped: set REALTIME_TEST_DOCKER=1 (needs a local Docker daemon and the Valkey image)");
}

describeWithDocker("ValkeyEntityChangeTransport continuity under server-level damage (disposable containers)", () => {
    jest.setTimeout(120_000);

    let live: Instance[] = [];
    const track = <T extends Instance>(i: T): T => {
        live.push(i);
        return i;
    };

    afterEach(() => {
        live.forEach((i) => i.destroy());
        live = [];
    });

    afterAll(async () => {
        proxies.forEach((p) => p.close());
        for (const name of containers) await docker("rm", "-f", "-v", name).catch(() => undefined);
        for (const net of networks) await docker("network", "rm", net).catch(() => undefined);
        for (const volume of volumes) await docker("volume", "rm", "-f", volume).catch(() => undefined);
    });

    async function scenario(server: Server, damage: (h: History) => Promise<void>): Promise<void> {
        const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
        const h = await writeHistory(server.url, streamKey);
        track(h.a);
        track(h.b);
        await publishHint(h);
        const seen = h.live.length;
        await damage(h);
        await expectRecovered(server.url, h, seen);
    }

    it("FLUSHDB", async () => {
        const server = await startServer("flushdb");
        await scenario(server, async () => {
            const admin = new Redis(server.url);
            try {
                await admin.flushdb();
            } finally {
                admin.disconnect();
            }
        });
    });

    it("FLUSHALL", async () => {
        const server = await startServer("flushall");
        await scenario(server, async () => {
            const admin = new Redis(server.url);
            try {
                await admin.flushall();
            } finally {
                admin.disconnect();
            }
        });
    });

    it("restart without persistence", async () => {
        const server = await startServer("restart");
        await scenario(server, async () => {
            await crashAndRestart(server);
        });
    });

    describe("maxmemory eviction (allkeys-lru), the evicted key proven gone", () => {
        /** Fills the instance until `done` is true, keeping the keys named in `hot` recently used. */
        async function fillUntil(server: Server, hot: string[], done: (admin: Redis) => Promise<boolean>): Promise<void> {
            const admin = new Redis(server.url);
            try {
                const used = Number(/used_memory:(\d+)/.exec(await admin.info("memory"))?.[1]);
                await admin.config("SET", "maxmemory-policy", "allkeys-lru");
                await admin.config("SET", "maxmemory", String(used + 200 * 1024));
                const value = "x".repeat(4096);
                for (let i = 0; i < 20_000; i += 1) {
                    await admin.set(`filler:${i}`, value);
                    for (const key of hot) {
                        const type = await admin.type(key);
                        if (type === "hash") await admin.hlen(key);
                        else if (type === "stream") await admin.xlen(key);
                    }
                    if (i % 50 === 0 && (await done(admin))) return;
                }
                throw new Error("the key was not evicted");
            } finally {
                admin.disconnect();
            }
        }

        it.each([
            ["the stream key", true, false],
            ["the record (hash) key", false, true],
            ["both keys", true, true],
        ] as const)("%s evicted", async (_label, evictStream, evictRecord) => {
            const server = await startServer("evict");
            await scenario(server, async (h) => {
                const record = `${h.streamKey}:incarnation`;
                await fillUntil(
                    server,
                    [...(evictStream ? [] : [h.streamKey]), ...(evictRecord ? [] : [record])],
                    async (admin) => {
                        const stream = (await admin.exists(h.streamKey)) === 1;
                        const rec = (await admin.exists(record)) === 1;
                        return (!evictStream || !stream) && (!evictRecord || !rec);
                    },
                );
                const probe = new Redis(server.url);
                try {
                    // proven: the intended key(s) are really gone
                    if (evictStream) expect(await probe.exists(h.streamKey)).toBe(0);
                    if (evictRecord) expect(await probe.exists(record)).toBe(0);
                    await probe.config("SET", "maxmemory", "0"); // let the transports write again
                } finally {
                    probe.disconnect();
                }
            });
        });
    });

    describe("restores from older files (the keys, counters and `g` all roll back together)", () => {
        /**
         * The world as a restored server leaves it, before any transport has settled it: the document hint is gone, the
         * record still names the token's incarnation, and only the process (run_id) differs from the one that wrote it.
         */
        async function expectRolledBackWorld(server: Server, streamKey: string, token: string, owner: Instance): Promise<void> {
            const admin = new Redis(server.url);
            try {
                expect(await admin.xlen(streamKey)).toBe(1);
                const record = await admin.hgetall(`${streamKey}:incarnation`);
                expect(record["inc"]).toBe(incarnationOf(owner.cursorOf(token) as string));
                expect(record["f"]?.split(":")[0]).not.toBe(/run_id:(\w+)/.exec(await admin.info("server"))?.[1]);
            } finally {
                admin.disconnect();
            }
        }

        async function expectNewTransportRefuses(server: Server, streamKey: string, token: string, owner: Instance): Promise<void> {
            const fresh = track(instance(server.url, streamKey));
            await waitFor(() => fresh.transport.activeMode === "valkey", "a new transport on the restored server");
            expect(await fresh.transport.replayAfter(owner.cursorOf(token) as string)).toEqual({ honoured: false });
            const received = await reconnect(fresh, "branch-a", token);
            expect(received[0]?.data).toEqual({ resumed: false });
        }

        it("older RDB: a cursor kept across SAVE, publish, SHUTDOWN NOSAVE, restart is not honoured by a new transport", async () => {
            const server = await startServer("rdb");
            const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
            const h = await writeHistory(server.url, streamKey);
            const admin = new Redis(server.url);
            await admin.call("SAVE"); // the older state
            admin.disconnect();
            await publishHint(h);
            h.a.destroy();
            h.b.destroy(); // no transport is running while the server restarts, so none can settle the restored state

            await crashAndRestart(server);
            await expectRolledBackWorld(server, streamKey, h.token, h.b);
            await expectNewTransportRefuses(server, streamKey, h.token, h.b);
        });

        it("older RDB with transports running through the restart", async () => {
            const server = await startServer("rdb-live");
            const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
            const h = await writeHistory(server.url, streamKey);
            track(h.a);
            track(h.b);
            const admin = new Redis(server.url);
            await admin.call("SAVE");
            admin.disconnect();
            await publishHint(h);
            const seen = h.live.length;

            await crashAndRestart(server);
            await expectRecovered(server.url, h, seen);
        });

        it("older AOF: both keys rolled back by starting from an older append-only directory", async () => {
            const server = await startServer("aof", ["--appendonly", "yes", "--appendfsync", "always"]);
            const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
            const h = await writeHistory(server.url, streamKey);
            await docker("exec", server.name, "sh", "-c", "rm -rf /data/aof-old && cp -a /data/appendonlydir /data/aof-old"); // the older files
            await publishHint(h);
            h.a.destroy();
            h.b.destroy();

            await crashAndRestart(server, async () => {
                await docker(
                    "run", "--rm", "-v", `${server.name}-data:/data`, "--entrypoint", "sh", IMAGE,
                    "-c", "rm -rf /data/appendonlydir && mv /data/aof-old /data/appendonlydir",
                );
            });
            await expectRolledBackWorld(server, streamKey, h.token, h.b);
            await expectNewTransportRefuses(server, streamKey, h.token, h.b);
        });

        it("older AOF with transports running through the restart", async () => {
            const server = await startServer("aof-live", ["--appendonly", "yes", "--appendfsync", "always"]);
            const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
            const h = await writeHistory(server.url, streamKey);
            track(h.a);
            track(h.b);
            await docker("exec", server.name, "sh", "-c", "rm -rf /data/aof-old && cp -a /data/appendonlydir /data/aof-old");
            await publishHint(h);
            const seen = h.live.length;

            await crashAndRestart(server, async () => {
                await docker(
                    "run", "--rm", "-v", `${server.name}-data:/data`, "--entrypoint", "sh", IMAGE,
                    "-c", "rm -rf /data/appendonlydir && mv /data/aof-old /data/appendonlydir",
                );
            });
            await expectRecovered(server.url, h, seen);
        });
    });

    describe("replication", () => {
        const info = async (server: Server, section: string): Promise<string> => {
            const admin = new Redis(server.url);
            try {
                return await admin.info(section);
            } finally {
                admin.disconnect();
            }
        };
        const field = (text: string, name: string) => new RegExp(`${name}:(\\S+)`).exec(text)?.[1];
        const call = async (server: Server, ...args: string[]) => {
            const admin = new Redis(server.url);
            try {
                return await admin.call(args[0] as string, ...args.slice(1));
            } finally {
                admin.disconnect();
            }
        };
        const BOGUS_MASTER = "rt-no-such-host.invalid";

        /** A TCP forwarder in front of the primary, so a failover can be played without changing the transports' URL. */
        function startProxy(targetPort: number) {
            let target = targetPort;
            const sockets = new Set<Socket>();
            const server = createServer((client) => {
                const upstream = connect(target, "127.0.0.1");
                sockets.add(client);
                sockets.add(upstream);
                client.pipe(upstream);
                upstream.pipe(client);
                const close = () => {
                    client.destroy();
                    upstream.destroy();
                    sockets.delete(client);
                    sockets.delete(upstream);
                };
                client.on("error", close);
                upstream.on("error", close);
                client.on("close", close);
                upstream.on("close", close);
            });
            proxies.push(server);
            return new Promise<{ url: string; retarget: (port: number) => void }>((resolve) => {
                server.listen(0, "127.0.0.1", () => {
                    resolve({
                        url: `redis://127.0.0.1:${(server.address() as AddressInfo).port}`,
                        retarget: (port) => {
                            target = port;
                            sockets.forEach((s) => s.destroy());
                        },
                    });
                });
            });
        }

        it("a lagging replica promoted while the cursor's id is still retained on it (it never saw the document hint)", async () => {
            const net = `${PREFIX}net-${randomBytes(3).toString("hex")}`;
            await docker("network", "create", net);
            networks.push(net);
            const primary = await startServer("primary", [], net);
            const replica = await startServer("replica", [], net);
            await call(replica, "REPLICAOF", primary.name, "6379");
            await waitFor(async () => field(await info(replica, "replication"), "master_link_status") === "up", "the replica to sync");

            const proxy = await startProxy(primary.port);
            const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
            const h = await writeHistory(proxy.url, streamKey);
            track(h.a);
            track(h.b);
            const replicaAdmin = new Redis(replica.url);
            try {
                await waitFor(async () => (await replicaAdmin.xlen(streamKey)) === 1, "the replica to hold the first batch");
                await call(replica, "REPLICAOF", BOGUS_MASTER, "6379"); // the link is cut; the replica keeps its data and lags from here
                await waitFor(async () => field(await info(replica, "replication"), "master_link_status") === "down", "the link to drop");
                await publishHint(h);
                expect(await replicaAdmin.xlen(streamKey)).toBe(1); // the cursor's id is retained there, the hint is not
                const seen = h.live.length;

                const primaryReplid = field(await info(primary, "replication"), "master_replid");
                await call(replica, "REPLICAOF", "NO", "ONE");
                expect(field(await info(replica, "replication"), "role")).toBe("master");
                expect(field(await info(replica, "replication"), "master_replid")).not.toBe(primaryReplid); // promotion changed the replication id

                proxy.retarget(replica.port); // the failover
                await expectRecovered(replica.url, h, seen);
            } finally {
                replicaAdmin.disconnect();
            }
        });

        it("demote and re-promote in the same process: run_id is unchanged, master_replid is not, and that alone refuses the cursor", async () => {
            const server = await startServer("demote");
            const streamKey = `rt-restore:${randomBytes(4).toString("hex")}`;
            const h = await writeHistory(server.url, streamKey);
            track(h.a);
            track(h.b);
            await publishHint(h);
            const seen = h.live.length;

            const runId = field(await info(server, "server"), "run_id");
            const replidBefore = field(await info(server, "replication"), "master_replid");
            await call(server, "REPLICAOF", BOGUS_MASTER, "6379");
            await waitFor(async () => field(await info(server, "replication"), "role") === "slave", "the demotion");
            await call(server, "REPLICAOF", "NO", "ONE");
            await waitFor(async () => field(await info(server, "replication"), "role") === "master", "the re-promotion");

            expect(field(await info(server, "server"), "run_id")).toBe(runId);
            expect(field(await info(server, "replication"), "master_replid")).not.toBe(replidBefore);
            await expectRecovered(server.url, h, seen);
        });
    });
});
