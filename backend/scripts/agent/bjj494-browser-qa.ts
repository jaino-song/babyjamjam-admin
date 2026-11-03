/** Local deterministic browser-QA harness. Importing this file starts nothing. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, createConnection, Socket } from "node:net";
import {
    applyQaEnv, restoreQaEnv, APPROVED_ENV_PATHS, QA_BACKEND_ORIGIN, QA_DATABASE_URL,
    assertQaDatabase, assertLocalSocketArguments, backendEnvironment, parseLocalEnv, parseQaOptions, type QaOptions,
} from "./bjj494-browser-qa.config";

interface Lifecycle {
    apply: () => Promise<unknown>; start: () => Promise<unknown>; wait: () => Promise<unknown>;
    stopNext: () => Promise<unknown>; stopBackend: () => Promise<unknown>;
    restore: () => Promise<unknown>; stopPg: () => Promise<unknown>;
}
export async function withQaLifecycle(steps: Lifecycle): Promise<void> {
    await steps.apply();
    try { await steps.start(); await steps.wait(); }
    finally {
        const failures: unknown[] = [];
        for (const stop of [steps.stopNext, steps.stopBackend]) {
            try { await stop(); } catch (error) { failures.push(error); }
        }
        try { if (failures.length === 0) await steps.restore(); }
        finally { await steps.stopPg(); }
        if (failures.length) throw new Error("QA children did not stop; URL recovery retained");
    }
}
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const PORTS = [62295, 63101, 63110, 63112];
async function portOpen(port: number): Promise<boolean> {
    return new Promise(done => {
        const socket = createConnection({ host: "127.0.0.1", port });
        const finish = (open: boolean) => { socket.destroy(); done(open); };
        socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.setTimeout(300, () => finish(false));
    });
}
async function requireFreePorts(ports: number[]): Promise<void> {
    for (const port of ports) await new Promise<void>((done, reject) => {
        const server = createServer(); server.once("error", () => reject(new Error("A dedicated QA port is occupied")));
        server.listen(port, "127.0.0.1", () => server.close(error => error ? reject(error) : done()));
    });
}
async function waitForPort(port: number, open: boolean, timeout = 90_000, aborted = () => false): Promise<void> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        if (aborted()) throw new Error("QA startup was interrupted");
        if (await portOpen(port) === open) return;
        await sleep(200);
    }
    throw new Error("QA port readiness/shutdown timed out");
}
function aliveGroup(pid: number): boolean { try { process.kill(-pid, 0); return true; } catch { return false; } }
async function stopGroup(child: ChildProcess | undefined, port: number): Promise<void> {
    if (child?.pid) {
        for (const signal of ["SIGTERM", "SIGKILL"] as const) {
            if (!aliveGroup(child.pid)) break;
            try { process.kill(-child.pid, signal); } catch { /* already exited */ }
            const until = Date.now() + 4_000;
            while (aliveGroup(child.pid) && Date.now() < until) await sleep(100);
        }
        if (aliveGroup(child.pid)) throw new Error("Owned QA process group survived shutdown");
    }
    await waitForPort(port, false, 10_000);
}
function command(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((done, reject) => {
        const child = spawn(binary, args, { cwd, env, stdio: "ignore" });
        child.once("error", () => reject(new Error("QA command could not start")));
        child.once("exit", code => code === 0 ? done() : reject(new Error(`QA command failed: ${binary}`)));
    });
}

async function startBackend(options: QaOptions, root: string): Promise<void> {
    assertQaDatabase(process.env["DATABASE_URL"], process.env["DIRECT_URL"]);
    if (process.env["E2E_VENDOR_STUBS"] !== "1" || process.env["STORAGE_BOOTSTRAP_DISABLED"] !== "1" || process.env["NODE_ENV"] !== "test") throw new Error("Unsafe QA backend environment");
    const originalConnect = Socket.prototype.connect;
    Socket.prototype.connect = function (...args: unknown[]): Socket {
        assertLocalSocketArguments(args);
        return Reflect.apply(originalConnect, this, args) as Socket;
    };
    // All application imports follow the environment checks, never import main.ts.
    await import("../../instrument");
    const [{ Test }, { Logger }, { HttpAdapterHost }, { AppModule }, { default: helmet }, { json }, { default: cookieParser },
        { GlobalValidationPipe }, { ServiceRecordSentryExceptionFilter }, { PrismaExceptionFilter },
        { AgentModelFactory }, { DeterministicAgentLanguageModel }, { GEMINI_GATEWAY }, { assertVendorStubsConfigured },
        { ReadinessService }, { createFatalProcessLifecycle }, { PrismaClient }, { default: bcrypt }] = await Promise.all([
        import("@nestjs/testing"), import("@nestjs/common"), import("@nestjs/core"), import("../../app.module"), import("helmet"), import("express"), import("cookie-parser"),
        import("../../infrastructure/pipes/global-validation.pipe"), import("../../infrastructure/observability/service-record-sentry-exception.filter"), import("../../infrastructure/filters/prisma-exception.filter"),
        import("../../infrastructure/agent/agent-model.factory"), import("../../infrastructure/agent/deterministic-agent-language-model"), import("../../module/ai-chat.tokens"),
        import("../../infrastructure/vendor-stubs/e2e-vendor-stubs"), import("../../infrastructure/health/readiness.service"), import("../../infrastructure/lifecycle/fatal-process-lifecycle"),
        import("@prisma/client"), import("bcrypt"),
    ]);
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    assertVendorStubsConfigured({ get: (key: string) => process.env[key] });
    Logger.overrideLogger(false); // Never emit credential-bearing request diagnostics.
    const prisma = new PrismaClient({ datasources: { db: { url: QA_DATABASE_URL } } });
    const local = parseLocalEnv(readFileSync(join(root, "frontend/.env.local"), "utf8"));
    const email = local["LOCAL_AUTO_LOGIN_EMAIL"]?.trim(); const password = local["LOCAL_AUTO_LOGIN_PASSWORD"];
    const branchName = local["LOCAL_AUTO_LOGIN_BRANCH_NAME"]?.trim();
    if (!email || !password || !branchName) throw new Error("Three existing local auto-login values are required");
    const user = await prisma.user.create({ data: {
        email, passwordHash: await bcrypt.hash(password, 12), name: "QA-BJJ494", role: "user", authProvider: "email",
        emailVerified: true, emailVerifiedAt: new Date(), approvalStatus: "approved", approvedAt: new Date(), tokenVersion: 0,
    } });
    const branch = await prisma.branch.create({ data: { name: branchName, slug: `bjj494-qa-${Date.now()}`, isActive: true } });
    await prisma.user_branch.create({ data: { userId: user.id, branchId: branch.id, role: options.role } });
    const approved = await prisma.client.create({ data: { branchId: branch.id, name: "QA-BJJ494-Approve", voucherClient: false, smsAutomationEnabled: false } });
    const rejected = await prisma.client.create({ data: { branchId: branch.id, name: "QA-BJJ494-Reject", voucherClient: false, smsAutomationEnabled: false } });
    await prisma.system_setting.create({ data: { key: "agent.flags", value: JSON.stringify({ enabled: true, rolloutStage: "development", risks: { "reversible-write": true } }) } });
    const publish = (message: object) => { process.send?.(message); };
    class QaModel extends DeterministicAgentLanguageModel {
        private delegate?: InstanceType<typeof DeterministicAgentLanguageModel>;
        constructor() { super([]); }
        override async doStream(input: unknown) {
            if (!this.delegate) {
                const prompt = JSON.stringify(input);
                const reject = prompt.lastIndexOf("QA_REJECT") > prompt.lastIndexOf("QA_APPROVE");
                this.delegate = new DeterministicAgentLanguageModel([
                    { type: "tool-call", toolName: "clients_update", input: { id: reject ? rejected.id : approved.id, name: reject ? "QA-BJJ494-Rejected" : "QA-BJJ494-Approved" } },
                    { type: "text", text: "QA-BJJ494: 승인 카드를 확인해 주세요. 아직 변경을 적용하지 않았어요." },
                ]);
            }
            return this.delegate.doStream(input);
        }
    }
    const gateway = {
        async *chatStream(messages: Array<{ role: string; content: string }>, tools: Array<{ name: string }> = []) {
            publish({ type: "legacy-tool-offers", names: tools.map(tool => tool.name) });
            const prompt = messages.filter(message => message.role === "user").at(-1)?.content ?? "";
            if (prompt.includes("QA_UNDECLARED")) yield { type: "function_call", functionCall: { name: "updateClient", args: { clientId: approved.id, name: "QA-BJJ494-Unauthorized" } } };
            else yield { type: "text", content: "산모 정보 수정이 완료되었습니다." };
            yield { type: "done" };
        },
        async chat() { throw new Error("Unscripted QA gateway call"); },
        async sendFunctionResult() { throw new Error("Unscripted QA gateway call"); },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AgentModelFactory).useValue({ modelId: "bjj494-deterministic-local", create: () => new QaModel(), providerOptions: () => ({}), maxOutputTokens: () => 8192 })
        .overrideProvider(GEMINI_GATEWAY).useValue(gateway).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    app.enableShutdownHooks();
    const readiness = app.get(ReadinessService);
    createFatalProcessLifecycle({ markNotReady: () => readiness.markNotReady(), shutdown: () => app.close(), exit: code => process.exit(code), logger: () => console.error("QA backend fatal error; details withheld") }).install();
    app.use(helmet()); app.use(json({ limit: "1mb" })); app.getHttpAdapter().getInstance().set("trust proxy", 1); app.use(cookieParser());
    app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)), new PrismaExceptionFilter());
    app.enableCors({ origin: ["http://127.0.0.1:63110", "http://127.0.0.1:63112", "http://localhost:3000"], credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "Cookie"] });
    app.getHttpAdapter().get("/", (_req: unknown, res: { send: (text: string) => void }) => res.send("BJJ494 synthetic local QA"));
    await app.listen(63101, "127.0.0.1");
    publish({ type: "fixture", userId: user.id, branchId: branch.id, identity: "QA-BJJ494", globalRole: "user", branchRole: options.role,
        approveClientId: approved.id, rejectClientId: rejected.id, prompts: { approve: "QA_APPROVE 산모 이름 수정", reject: "QA_REJECT 산모 이름 수정", legacy: "QA_CLAIM 산모 정보 수정", denied: "QA_UNDECLARED 산모 정보 수정" } });
    const timer = setInterval(() => {
        void Promise.all([
            prisma.client.findMany({ where: { id: { in: [approved.id, rejected.id] }, branchId: branch.id }, select: { id: true, name: true } }),
            prisma.agent_action.findMany({ where: { userId: user.id, branchId: branch.id }, select: { id: true, sessionId: true, capability: true, status: true } }),
            prisma.auth_session.findMany({ where: { userId: user.id, revokedAt: null }, select: { id: true, selectedBranchId: true, expiresAt: true } }),
            prisma.agent_message.findMany({ where: { session: { userId: user.id, branchId: branch.id } }, select: { id: true, role: true, parts: true } }),
        ]).then(([clients, actions, authSessions, messages]) => publish({ type: "facts", clients, actions, authSessions,
            messages: messages.map(message => ({ id: message.id, role: message.role, partTypes: Array.isArray(message.parts) ? message.parts.map(part => part && typeof part === "object" && !Array.isArray(part) ? part["type"] : null) : [] })) }),
        () => publish({ type: "facts-error" }));
    }, 2000);
    app.getHttpServer().on("close", () => { clearInterval(timer); void prisma.$disconnect(); });
}

async function run(options: QaOptions): Promise<void> {
    const root = resolve(__dirname, "../../.."); const backend = join(root, "backend"); const envPath = join(root, "frontend/.env.local");
    if (!(APPROVED_ENV_PATHS as readonly string[]).includes(envPath)) throw new Error("QA runner requires an approved isolated worktree");
    if (options.internalBackend) { await startBackend(options, root); return; }
    await requireFreePorts(PORTS);
    if (options.recover) { restoreQaEnv(envPath); console.log("QA URL recovered after all dedicated ports were confirmed closed"); return; }
    const env = backendEnvironment(root); assertQaDatabase(env["DATABASE_URL"], env["DIRECT_URL"]);
    const version = execFileSync("postgres", ["--version"], { env, encoding: "utf8" }).trim();
    if (!/^postgres \(PostgreSQL\) 16\.13(?:\s|$)/.test(version)) throw new Error("QA requires PostgreSQL 16.13");
    const directory = mkdtempSync(join(tmpdir(), "bjj494-browser-qa-")); const data = join(directory, "data");
    let pgStarted = false; let api: ChildProcess | undefined; let desktop: ChildProcess | undefined; let mobile: ChildProcess | undefined;
    const metadata: Record<string, unknown> = { sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), postgres: version, mode: options.mode, role: options.role, ports: PORTS, runDirectory: directory, parentPid: process.pid, processGroups: {} };
    const save = () => writeFileSync(join(directory, "public.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
    let resolveShutdown!: () => void;
    let stopping = false; let unexpectedExit = false;
    const shutdown = new Promise<void>(done => { resolveShutdown = done; });
    const signal = () => { stopping = true; resolveShutdown(); };
    const ensureRunning = () => { if (stopping) throw new Error("QA startup was interrupted"); };
    process.once("SIGINT", signal); process.once("SIGTERM", signal);
    const launch = (binary: string, args: string[], cwd: string, childEnv: NodeJS.ProcessEnv, ipc = false) => {
        const child = spawn(binary, args, { cwd, env: childEnv, detached: true, stdio: ipc ? ["ignore", "ignore", "ignore", "ipc"] : "ignore" });
        const failed = () => { if (!stopping) unexpectedExit = true; signal(); };
        child.once("error", failed); child.once("exit", failed);
        return child;
    };
    console.log(`QA_RUN_DIRECTORY=${directory}`);
    await withQaLifecycle({
        apply: async () => { applyQaEnv(envPath); },
        start: async () => {
            save(); ensureRunning();
            await command("initdb", ["--auth=trust", "-U", "bjj_revision_test", "-D", data], backend, env);
            ensureRunning();
            await command("pg_ctl", ["-D", data, "-o", `-c listen_addresses=127.0.0.1 -p 62295 -k ${directory}`, "-l", join(directory, "postgres.log"), "-w", "start"], backend, env);
            pgStarted = true; ensureRunning();
            await command("createdb", ["-h", "127.0.0.1", "-p", "62295", "-U", "bjj_revision_test", "bjj_revision_task4"], backend, env);
            ensureRunning(); assertQaDatabase(env["DATABASE_URL"], env["DIRECT_URL"]);
            await command("pnpm", ["exec", "prisma", "migrate", "deploy"], backend, env);
            ensureRunning();
            api = launch(process.execPath, ["-r", "ts-node/register", __filename, "--internal-backend", "--mode", options.mode, "--role", options.role], backend, env, true);
            const groups: Record<string, number | undefined> = { backend: api.pid };
            metadata["processGroups"] = groups; save();
            api.on("message", message => {
                if (message && typeof message === "object" && "type" in message && typeof message.type === "string" && ["fixture", "facts", "facts-error", "legacy-tool-offers"].includes(message.type)) { metadata[message.type] = message; save(); }
            });
            await waitForPort(63101, true, 90_000, () => stopping);
            // Native qa launchers read the unchanged credentials directly from the
            // adapted file. The public URL and recognized UI flag are process-only.
            const uiEnv: NodeJS.ProcessEnv = {};
            for (const key of ["PATH", "HOME", "TMPDIR", "USER", "LANG"]) if (env[key]) uiEnv[key] = env[key];
            Object.assign(uiEnv, { NEXT_PUBLIC_API_BASE_URL: QA_BACKEND_ORIGIN, NEXT_PUBLIC_AGENT_SHELL_ENABLED: String(options.mode === "agent"), NEXT_TELEMETRY_DISABLED: "1" });
            desktop = launch("pnpm", ["qa:fe", "--", "--port", "63110"], root, uiEnv);
            groups["desktop"] = desktop.pid; save(); ensureRunning();
            mobile = launch("pnpm", ["qa:mobile", "--", "--port", "63112"], root, uiEnv);
            groups["mobile"] = mobile.pid; save();
            await Promise.all([waitForPort(63110, true, 90_000, () => stopping), waitForPort(63112, true, 90_000, () => stopping)]);
            console.log(`QA_READY mode=${options.mode} role=${options.role} desktop=http://127.0.0.1:63110 mobile=http://127.0.0.1:63112`);
            console.log("QA facts and synthetic prompts: public.json in QA_RUN_DIRECTORY; stop with SIGINT");
        },
        wait: async () => { await shutdown; if (unexpectedExit) throw new Error("An owned QA process exited unexpectedly"); },
        stopNext: async () => { stopping = true; await Promise.all([stopGroup(desktop, 63110), stopGroup(mobile, 63112)]); },
        stopBackend: async () => { await stopGroup(api, 63101); },
        restore: async () => { restoreQaEnv(envPath); },
        stopPg: async () => {
            if (pgStarted || existsSync(join(data, "postmaster.pid"))) await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], backend, env);
            await waitForPort(62295, false, 10_000); rmSync(directory, { recursive: true, force: true });
        },
    });
    console.log("QA_STOPPED: owned groups and ports closed; URL restored; disposable cluster removed");
}

if (require.main === module) {
    void run(parseQaOptions(process.argv.slice(2))).catch(() => { console.error("BJJ494 QA failed; inspect public metadata, stop owned groups before explicit --recover; no credentials logged"); process.exitCode = 1; });
}
