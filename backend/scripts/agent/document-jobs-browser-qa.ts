/** Disposable document-jobs browser QA. Importing this module starts nothing. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
    QA_DATABASE_URL, QA_PORTS, QA_IDENTITY_PATH, assertQaDatabase, assertQaPortsFree,
    backendOrigins, createOwnedChildren, verifyQaBackendIdentity, reportQaFailure,
} from "./document-jobs-browser-qa.config";
import { backendEnvironment, parseLocalEnv } from "./bjj494-browser-qa.config";

const ROOT = resolve(__dirname, "../../..");
const BACKEND = join(ROOT, "backend");
const PG_BIN = "/opt/homebrew/opt/postgresql@16/bin";
const ORIGIN = "http://127.0.0.1:3001";
const FRONTEND = "http://127.0.0.1:63210";
const DAY = 86_400_000;
let stage = "arguments";
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function demand(valid: unknown, message: string): asserts valid { if (!valid) throw new Error(message); }
const text = (value: unknown): string => { demand(typeof value === "string" && value.length > 0, "Missing QA string"); return value; };
const object = (value: unknown): Record<string, unknown> => { demand(value && typeof value === "object" && !Array.isArray(value), "Invalid QA response"); return value as Record<string, unknown>; };

/** Preload is written only inside this run's owned temporary directory; no inherited NODE_OPTIONS. */
export const QA_SOCKET_GUARD = `const net=require('node:net'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const directory=path.dirname(__filename),journal=path.join(directory,'refusals.log'),marker=path.join(directory,'frontend-owner.json');
const original=net.Socket.prototype.connect,pid=n=>Number.isSafeInteger(n)&&n>0;
function metadata(id){if(!pid(id))throw Error('Invalid QA PID');const row=cp.execFileSync('/bin/ps',['-o','pid=,ppid=,pgid=','-p',String(id)],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2000}).trim().split(/\\s+/);if(row.length!==3||!row.every(n=>/^[1-9]\\d*$/.test(n)&&pid(Number(n)))||Number(row[0])!==id)throw Error('Invalid QA process');return row.map(Number);}
function parentOwns(port){try{const owner=JSON.parse(fs.readFileSync(marker,'utf8'));if(!owner||Object.keys(owner).sort().join(',')!=='frontendPgid,frontendPid,runnerPid'||!Object.values(owner).every(pid))return false;
const child=metadata(process.pid),parent=metadata(process.ppid),root=metadata(owner.frontendPid);metadata(owner.runnerPid);
if(child[1]!==process.ppid||child[2]!==owner.frontendPgid||parent[2]!==owner.frontendPgid||root[2]!==owner.frontendPgid||root[1]!==owner.runnerPid)return false;
const rows=cp.execFileSync('${process.platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof"}',['-nP','-iTCP@127.0.0.1:'+port,'-sTCP:LISTEN','-Fp'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2000}).trim().split('\\n');let seen=false;
for(const row of rows){if(/^p[1-9]\\d*$/.test(row)){if(Number(row.slice(1))!==process.ppid)return false;seen=true;}else if(!seen||!/^f\\d+$/.test(row))return false;}return seen;
}catch{return false;}}
net.Socket.prototype.connect=function(...raw){const a=Array.isArray(raw[0])?raw[0]:raw;const first=a[0];let host='localhost',port;
if(first&&typeof first==='object'){if(typeof first.path==='string'&&first.port==null)return Reflect.apply(original,this,raw);host=first.host??first.hostname??host;port=first.port;}
else if(typeof first==='string'&&!/^\\d+$/.test(first))return Reflect.apply(original,this,raw);
else{port=first;if(typeof a[1]==='string')host=a[1];}
const allowedHost=['localhost','127.0.0.1','::1','[::1]'].includes(host),p=Number(port);
const effectiveHost=first&&typeof first==='object'?first.host??'localhost':host;
if(allowedHost&&[62395,3001,63210].includes(p)||effectiveHost==='127.0.0.1'&&Number.isSafeInteger(p)&&p>=1024&&p<=65535&&parentOwns(p))return Reflect.apply(original,this,raw);
const line='QA_SOCKET_REFUSED pid='+process.pid+' port='+(Number.isInteger(p)&&p>0&&p<=65535?p:0)+'\\n';
try{const fd=fs.openSync(journal,fs.constants.O_WRONLY|fs.constants.O_APPEND);try{if(fs.writeSync(fd,line)!==line.length)throw Error('Partial QA journal write');}finally{fs.closeSync(fd);}}finally{fs.writeSync(2,line);}
throw Error(allowedHost?'QA unowned port refused':'QA nonloopback socket refused');};
Object.defineProperty(net.Socket.prototype.connect,Symbol.for('bjj.document-jobs.loopback-guard'),{value:true});`;

export function initializeQaJournal(file: string): void { writeFileSync(file, "", { flag: "wx", mode: 0o600 }); }
export function verifyQaJournal(file: string, browserReady = false): Array<{ pid: number; port: number }> {
    const data = readFileSync(file, "utf8");
    const rows = data === "" ? [] : data.split("\n").slice(0, -1).map(line => {
        const match = /^QA_SOCKET_REFUSED pid=([1-9]\d*) port=([1-9]\d*)$/.exec(line);
        demand(match && Number.isSafeInteger(Number(match[1])) && Number(match[2]) <= 65535, "Invalid QA refusal journal");
        return { pid: Number(match[1]), port: Number(match[2]) };
    });
    demand(data === "" || data.endsWith("\n"), "Partial QA refusal journal");
    demand(browserReady ? rows.length <= 1 && rows.every(row => row.port === 443) : rows.length === 0, "Unexpected QA socket refusal");
    return rows;
}
export function openQaBrowserGate(file: string, readyAt: number, alive: boolean): boolean {
    demand(alive, "QA frontend exited before browser gate"); verifyQaJournal(file);
    if (Date.now() - readyAt < 60_000) return false;
    console.log("QA_BROWSER_READY"); return true;
}
export function parseQaArguments(args: string[]): { serve: boolean; browser: boolean } {
    demand(args.length === 1 && ["--check", "--serve"].includes(args[0] ?? "") || args.length === 2 && args.includes("--serve") && args.includes("--browser"), "Use --check or --serve [--browser]");
    return { serve: args.includes("--serve"), browser: args.includes("--browser") };
}

function baseEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "USER", "LANG"]) if (process.env[key]) env[key] = process.env[key];
    env["PATH"] = `${PG_BIN}:${env["PATH"] ?? "/usr/bin:/bin"}`;
    return env;
}
export function frontendEnvironment(guard: string, apiOrigin: string): NodeJS.ProcessEnv {
    return { ...baseEnvironment(), NEXT_PUBLIC_API_BASE_URL: apiOrigin, NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: `--require ${JSON.stringify(guard)}`, CI: "1", __NEXT_AGENT_UPGRADE: "security" };
}
function databaseEnvironment(): NodeJS.ProcessEnv {
    const env = { ...backendEnvironment(ROOT), ...baseEnvironment(), DATABASE_URL: QA_DATABASE_URL, DIRECT_URL: QA_DATABASE_URL,
        DEVELOPMENT_FRONTEND_URL: FRONTEND, DEVELOPMENT_MOBILE_FRONTEND_URL: FRONTEND };
    assertQaDatabase(env.DATABASE_URL, env.DIRECT_URL);
    return env;
}
async function wire(path: string, body?: object, token?: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${ORIGIN}${path}`, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Object.assign(new Error("QA HTTP response failed"), { qaHttpStatus: response.status });
    return object(await response.json());
}
function listenerOwned(port: number, group: number): boolean {
    let output: string;
    try { output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1000 }); }
    catch (error) {
        const result = error as { status?: number; stdout?: unknown; stderr?: unknown };
        if (result.status === 1 && !String(result.stdout ?? "").trim() && !String(result.stderr ?? "").trim()) return false;
        throw new Error("QA listener inspection failed");
    }
    let pid = "", seen = false;
    for (const line of output.trim().split("\n")) {
        if (/^p[1-9]\d*$/.test(line)) pid = line.slice(1);
        else if (/^f\d+$/.test(line)) continue;
        else if (line.startsWith("n")) {
            demand(pid && line === `n127.0.0.1:${port}`, "Unexpected QA listener address");
            demand(execFileSync("ps", ["-o", "pgid=", "-p", pid], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1000 }).trim() === String(group), "QA listener is not owned");
            seen = true;
        } else throw new Error("Unexpected QA listener record");
    }
    return seen;
}

async function seed(prisma: PrismaClient, runId: string): Promise<{ branchId: string; unresolved: string[]; email: string; password: string }> {
    assertQaDatabase(process.env["DATABASE_URL"], process.env["DIRECT_URL"]);
    const local = parseLocalEnv(readFileSync(join(ROOT, "frontend/.env.local"), "utf8"));
    const email = text(local["LOCAL_AUTO_LOGIN_EMAIL"]?.trim()), password = text(local["LOCAL_AUTO_LOGIN_PASSWORD"]);
    const branchName = text(local["LOCAL_AUTO_LOGIN_BRANCH_NAME"]?.trim());
    const { default: bcrypt } = await import("bcrypt");
    const now = new Date();
    const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), name: "전자문서 로컬 QA",
        role: "user", authProvider: "email", emailVerified: true, emailVerifiedAt: now, approvalStatus: "approved", approvedAt: now,
        tokenVersion: 0, phone: "01000000000", birthDate: "1990-01-01" } });
    const branch = await prisma.branch.create({ data: { name: branchName, slug: `document-jobs-qa-${runId}`, isActive: true } });
    await prisma.user_branch.create({ data: { userId: user.id, branchId: branch.id, role: "admin" } });
    const clients = [];
    const documents = new Map<number, string>();
    for (let index = 0; index < 6; index++) {
        const client = await prisma.client.create({ data: { branchId: branch.id, name: `로컬 확인 고객 ${String.fromCharCode(65 + index)}`,
            voucherClient: false, smsAutomationEnabled: false, startDate: now } });
        clients.push(client);
        if ([1, 3, 5].includes(index)) {
            const documentId = `qa-document-${runId}-${index}`;
            await prisma.eformsign_doc.create({ data: { documentId, branchId: branch.id, clientId: client.id, createdDate: now, updatedDate: now,
                statusType: "050", statusDetail: "Complete", stepType: "reviewer", stepIndex: "1", stepName: "reviewer",
                stepRecipientType: "client", stepRecipientName: client.name, stepRecipientSms: "01000000000", expiredDate: new Date("2099-01-01") } });
            documents.set(index, documentId);
        }
    }
    const statuses = ["processing", "queued", "failed", "requires_attention", "completed", "completed"];
    const unresolved: string[] = [];
    for (const [index, client] of clients.entries()) {
        const documentId = documents.get(index) ?? null, finalize = [1, 3, 5].includes(index);
        const job = await prisma.eformsign_document_job.create({ data: { branchId: branch.id, clientId: client.id, documentId,
            jobType: finalize ? "finalize_document" : "create_document", source: index === 4 ? "auto_finalize" : "staff", status: text(statuses[index]),
            requestKey: index === 4 ? "service-record-initial-finalization:1" : `qa:${runId}:${index}`,
            activeKey: [0, 1, 3].includes(index) ? (finalize ? `finalize:${documentId}` : `create:${branch.id}:${client.id}`) : null,
            ...(index === 5 ? {} : { payload: index === 4 ? { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION" }
                : finalize ? { documentId: text(documentId) } : { clientId: client.id, contractData: { customerName: client.name } } }),
            progressStep: index === 0 ? "preparing" : index === 1 ? "queued" : index === 3 ? "creating" : null,
            lastErrorCode: index === 2 ? "PRE_SEND_RETRY_EXHAUSTED" : index === 3 ? "PROVIDER_STATE_UNAVAILABLE" : null,
            attempts: index === 1 ? 0 : 1, nextAttemptAt: new Date(now.getTime() + DAY), heartbeatAt: now,
            createdAt: new Date(now.getTime() - index * 1000), completedAt: index > 1 ? new Date(now.getTime() - index * 1000) : null } });
        if ([2, 3].includes(index)) unresolved.push(job.id);
    }
    const employee = await prisma.employee.create({ data: { name: "로컬 확인 제공인력", phone: "01000000000", grade: "일반", workArea: ["서울"],
        branchId: branch.id, smsAutomationEnabled: false } });
    const first = clients[0]; demand(first, "Missing QA client");
    await prisma.employee_schedule.create({ data: { branchId: branch.id, clientId: first.id, primaryEmployeeId: employee.id,
        workAddress: "로컬 QA 주소", startDate: new Date(now.getTime() - 3 * DAY), endDate: new Date(now.getTime() + 10 * DAY), replaced: false } });
    for (const read of [false, true]) await prisma.notification.create({ data: { userId: user.id, branchId: branch.id,
        title: "로컬 전자문서 확인", body: "합성 작업 현황을 확인해 주세요.", data: { type: "eformsign_document_job_failed", url: "/contracts" }, readAt: read ? now : null } });
    return { branchId: branch.id, unresolved, email, password };
}

async function authenticateAndCheck(fixture: Awaited<ReturnType<typeof seed>>): Promise<void> {
    stage = "login";
    const login = await wire("/auth/login", { email: fixture.email, password: fixture.password });
    demand(login["success"] === true, "Unsupported QA login response");
    const selected = await wire("/auth/select-branch", { branchId: fixture.branchId }, text(login["accessToken"]));
    const token = text(selected["accessToken"]); demand(selected["success"] === true, "Unsupported QA branch response");
    stage = "authenticated-job-api";
    const summary = await wire("/eformsign-docs/jobs/summary", undefined, token);
    demand(summary["activeCount"] === 2 && summary["requiresAttentionCount"] === 1 && summary["failedCount"] === 1 && summary["unresolvedCount"] === 2, "Unexpected QA summary");
    demand(JSON.stringify((summary["unresolvedJobIds"] as string[]).slice().sort()) === JSON.stringify(fixture.unresolved.slice().sort()), "Unexpected QA unresolved jobs");
    const list = await wire("/eformsign-docs/jobs", undefined, token);
    const groups = [list["active"], list["requiresAttention"], list["recent"]];
    demand(groups.every(group => Array.isArray(group) && group.length === 2), "Unexpected QA group counts");
    const expectedGroups = [["로컬 확인 고객 A", "로컬 확인 고객 B"], ["로컬 확인 고객 C", "로컬 확인 고객 D"], ["로컬 확인 고객 E", "로컬 확인 고객 F"]];
    groups.forEach((group, index) => {
        const names = (group as unknown[]).map(item => text(object(item)["clientName"])).sort();
        demand(JSON.stringify(names) === JSON.stringify(expectedGroups[index]?.slice().sort()), "Unexpected QA group membership");
    });
    const jobs = groups.flatMap(group => group as unknown[]).map(object);
    const expected = [
        ["A", "processing", "service_contract", "generate", null, null], ["B", "queued", "service_contract", "review", null, null],
        ["C", "failed", "service_contract", "generate", "manual_send", "PRE_SEND_RETRY_EXHAUSTED"],
        ["D", "requires_attention", "service_contract", "review", "verify_result", "PROVIDER_STATE_UNAVAILABLE"],
        ["E", "completed", "service_record", "generate", null, null], ["F", "completed", "service_contract", "review", null, null],
    ];
    for (const [name, ...projection] of expected) {
        const job = jobs.find(item => item["clientName"] === `로컬 확인 고객 ${name}`); demand(job, "Missing QA job");
        demand([job["status"], job["documentKind"], job["displayOperation"], job["recoveryKind"], job["failureReasonCode"]].every((value, index) => value === projection[index]), "Unexpected QA projection");
        demand(!["payload", "leaseToken", "activeKey"].some(key => key in job), "Unsafe QA projection");
    }
}

async function startBackend(runId: string): Promise<void> {
    stage = "backend-environment";
    demand(process.connected, "QA backend requires its parent IPC channel");
    demand(Object.getOwnPropertyDescriptor(Socket.prototype.connect, Symbol.for("bjj.document-jobs.loopback-guard"))?.value === true, "QA socket guard is required");
    assertQaDatabase(process.env["DATABASE_URL"], process.env["DIRECT_URL"]);
    demand(process.env["NODE_ENV"] === "test" && process.env["E2E_VENDOR_STUBS"] === "1"
        && process.env["SCHEDULERS_ENABLED"] === "false" && process.env["STORAGE_BOOTSTRAP_DISABLED"] === "1", "Unsafe QA backend environment");
    await import("../../instrument");
    const [{ Test }, { Logger }, { HttpAdapterHost }, { AppModule }, { default: helmet }, { json }, { default: cookieParser },
        { GlobalValidationPipe }, { ServiceRecordSentryExceptionFilter }, { PrismaExceptionFilter }, { assertVendorStubsConfigured }, { PrismaClient }] = await Promise.all([
        import("@nestjs/testing"), import("@nestjs/common"), import("@nestjs/core"), import("../../app.module"), import("helmet"), import("express"), import("cookie-parser"),
        import("../../infrastructure/pipes/global-validation.pipe"), import("../../infrastructure/observability/service-record-sentry-exception.filter"),
        import("../../infrastructure/filters/prisma-exception.filter"), import("../../infrastructure/vendor-stubs/e2e-vendor-stubs"), import("@prisma/client"),
    ]);
    Logger.overrideLogger(false); assertVendorStubsConfigured({ get: (key: string) => process.env[key] });
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    const prisma = new PrismaClient({ datasources: { db: { url: QA_DATABASE_URL } } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    const servers: Server[] = [];
    let closing: Promise<void> | undefined;
    const closeServers = () => Promise.all(servers.map(server => new Promise<void>(done => { if (!server.listening) return done(); server.close(() => done()); server.closeAllConnections(); })));
    const close = () => closing ??= (async () => {
        await closeServers();
        await app.close(); await prisma.$disconnect(); if (process.connected) process.disconnect();
    })();
    const ensureParent = () => demand(process.connected && !closing, "QA backend parent disconnected");
    const signal = () => { void close().catch(() => { process.exitCode = 1; }); };
    const publish = (message: object) => { if (process.connected) process.send?.(message, error => { if (error) signal(); }); };
    process.on("SIGINT", signal); process.on("SIGTERM", signal);
    process.once("disconnect", signal);
    try {
        ensureParent();
        stage = "backend-bootstrap";
        app.use(helmet()); app.use(json({ limit: "1mb" })); app.use(cookieParser());
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)), new PrismaExceptionFilter());
        app.enableCors({ origin: [FRONTEND], credentials: true, allowedHeaders: ["Content-Type", "Authorization", "Cookie"] });
        app.getHttpAdapter().get(QA_IDENTITY_PATH, (_request: unknown, response: { json: (body: object) => void }) => response.json({ runId }));
        await app.init(); ensureParent();
        for (const host of ["127.0.0.1", "::1"]) {
            ensureParent();
            const server = createServer(app.getHttpAdapter().getInstance()); servers.push(server);
            await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(QA_PORTS[1], host, () => done()); });
            ensureParent();
        }
        stage = "owned-backend-identity";
        await verifyQaBackendIdentity(servers, backendOrigins(readFileSync(join(ROOT, "frontend/.env.local"), "utf8")), runId);
        ensureParent();
        stage = "synthetic-seed";
        const fixture = await seed(prisma, runId); ensureParent(); await authenticateAndCheck(fixture); ensureParent();
        publish({ type: "ready", runId, branchId: fixture.branchId, syntheticJobs: 6, groups: [2, 2, 2] });
    } catch (error) { publish({ type: "failed", stage }); await closeServers(); await close(); await prisma.$disconnect(); throw error; }
}

export async function cleanupQaRun(owners: ReturnType<typeof createOwnedChildren>, active: Set<ChildProcess>, launched: ChildProcess[], directory: string, journal: string, browserReady: boolean, detach: () => void): Promise<void> {
    const stopChild = async (child: ChildProcess, index: number) => {
        const drained = () => {
            if (active.has(child)) return false;
            if (!child.pid) return true;
            try { process.kill(-child.pid, 0); return false; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; reportQaFailure("group-probe", error, index, undefined, child); throw error; }
        };
        for (const signal of ["SIGTERM", "SIGKILL"] as const) {
            if (drained()) return;
            if (active.has(child)) {
                try { owners.stop(child, signal); }
                catch (error) { reportQaFailure("group-signal", error, index, signal, child); throw error; }
            }
            const deadline = Date.now() + 4000;
            while (!drained() && Date.now() < deadline) await sleep(50);
        }
        demand(drained(), "Owned QA process group survived shutdown");
    };
    const failures: unknown[] = []; let journalFailure: unknown;
    try { verifyQaJournal(journal, browserReady); } catch (error) { reportQaFailure("journal-before", error); journalFailure = error; }
    const indices = new Map(launched.map((child, index) => [child, index]));
    for (const child of launched.reverse()) { try { await stopChild(child, indices.get(child)!); } catch (error) { failures.push(error); } }
    try { verifyQaJournal(journal, browserReady); } catch (error) { reportQaFailure("journal-after", error); journalFailure = error; }
    if (!failures.length) {
        try { rmSync(directory, { recursive: true, force: true }); }
        catch (error) { reportQaFailure("directory-remove", error); throw error; }
    }
    detach();
    demand(!failures.length, "QA cleanup incomplete; owned directory retained");
    console.log("QA_STOPPED owned children exited; disposable directory removed");
    if (journalFailure) throw journalFailure;
}

export async function withQaCleanup(execute: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
    try { await execute(); }
    catch (error) { reportQaFailure("execution", error); throw error; }
    finally { await cleanup(); }
}

async function run(serve: boolean, browser: boolean): Promise<void> {
    const owners = createOwnedChildren(), active = new Set<ChildProcess>(), launched: ChildProcess[] = [];
    const directory = mkdtempSync(join(tmpdir(), "bjj-document-jobs-qa-")), data = join(directory, "data"), guard = join(directory, "loopback.cjs");
    const journal = join(directory, "refusals.log"); let browserReady = false;
    let stopping = false, unexpected = false, stopped!: () => void;
    const stopRequested = new Promise<void>(done => { stopped = done; });
    const stop = () => { stopping = true; stopped(); };
    const ensure = () => { demand(!stopping, "QA startup interrupted"); verifyQaJournal(journal, browserReady); };
    const launch = (binary: string, args: string[], env: NodeJS.ProcessEnv, cwd = BACKEND, ipc = false, short = false): ChildProcess => {
        const child = owners.spawn(binary, args, { cwd, env, stdio: ipc ? ["ignore", "ignore", "pipe", "ipc"] : ["ignore", "ignore", "pipe"] });
        active.add(child); launched.push(child);
        // Forward only the guard's numeric diagnostics, never request bodies, headers or raw child stderr.
        let diagnostic = ""; child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (part: string) => {
            const lines = (diagnostic + part).split("\n"); diagnostic = (lines.pop() ?? "").slice(-256);
            for (const line of lines) { const match = /^QA_SOCKET_REFUSED pid=(\d+) port=(\d+)$/.exec(line); if (match) console.error(`QA_SOCKET_REFUSED pid=${match[1]} port=${match[2]}`); }
        });
        child.once("exit", () => { active.delete(child); if (!stopping && (!short || child.exitCode !== 0)) { unexpected = true; stop(); } });
        child.once("error", () => { active.delete(child); unexpected = true; stop(); });
        return child;
    };
    const wait = async (condition: () => boolean | Promise<boolean>, timeout = 90_000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) { ensure(); if (await condition()) return; await sleep(100); }
        throw new Error("QA readiness timeout");
    };
    const command = async (binary: string, args: string[], env: NodeJS.ProcessEnv) => {
        assertQaDatabase(env["DATABASE_URL"], env["DIRECT_URL"]);
        const child = launch(binary, args, env, BACKEND, false, true);
        await wait(() => child.exitCode !== null || child.signalCode !== null, 120_000);
        demand(child.exitCode === 0, "QA setup command failed");
    };
    const emergency = () => { for (const child of active) { try { owners.stop(child, "SIGKILL"); } catch { /* normal cleanup retains failures */ } } };
    process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop); process.once("exit", emergency);
    await withQaCleanup(async () => {
        stage = "preflight";
        initializeQaJournal(journal);
        writeFileSync(guard, QA_SOCKET_GUARD, { mode: 0o600 }); createRequire(__filename)(guard);
        await assertQaPortsFree();
        const source = readFileSync(join(ROOT, "frontend/.env.local"), "utf8"), origins = backendOrigins(source);
        const env = databaseEnvironment(); env["NODE_OPTIONS"] = `--require ${JSON.stringify(guard)}`;
        assertQaDatabase(env["DATABASE_URL"], env["DIRECT_URL"]);
        const postgres = join(PG_BIN, "postgres"), initdb = join(PG_BIN, "initdb"), createdb = join(PG_BIN, "createdb");
        demand([postgres, initdb, createdb].every(existsSync), "Installed PostgreSQL 16 is required");
        demand(/^postgres \(PostgreSQL\) 16\./.test(execFileSync(postgres, ["--version"], { env, encoding: "utf8" })), "PostgreSQL 16 required");
        stage = "postgres-init";
        await command(initdb, ["--auth=trust", "-U", new URL(QA_DATABASE_URL).username, "-D", data], env);
        stage = "postgres-start";
        const pg = launch(postgres, ["-D", data, "-c", "listen_addresses=127.0.0.1", "-p", "62395", "-k", directory], env);
        const pgGroup = pg.pid; demand(pgGroup, "Missing owned PostgreSQL process");
        await wait(() => {
            if (!existsSync(join(data, "postmaster.pid"))) return false;
            const recorded = readFileSync(join(data, "postmaster.pid"), "utf8").split("\n")[0]?.trim(); if (!recorded) return false;
            demand(Number(recorded) === pgGroup, "PostgreSQL ownership mismatch");
            return listenerOwned(QA_PORTS[0], pgGroup);
        });
        stage = "database-create";
        await command(createdb, ["-h", "127.0.0.1", "-p", "62395", "-U", new URL(QA_DATABASE_URL).username, "bjj_document_jobs_qa"], env);
        stage = "migrate";
        await command(process.execPath, [join(BACKEND, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { ...env, CHECKPOINT_DISABLE: "1" });
        stage = "backend-start";
        const runId = randomUUID(), api = launch(process.execPath, ["-r", "ts-node/register", __filename, "--backend", runId], env, BACKEND, true);
        let ready = false;
        api.on("message", message => {
            if (!message || typeof message !== "object" || !("type" in message)) return;
            if (message.type === "ready" && "runId" in message && message.runId === runId) ready = true;
            if (message.type === "failed") {
                if ("stage" in message && ["backend-environment", "backend-bootstrap", "owned-backend-identity", "synthetic-seed", "login", "authenticated-job-api"].includes(String(message.stage))) stage = String(message.stage);
                unexpected = true; stop();
            }
        });
        await wait(() => ready, 120_000);
        ensure(); demand(readFileSync(join(ROOT, "frontend/.env.local"), "utf8") === source, "QA source changed during startup");
        stage = "frontend-start";
        const frontend = launch("pnpm", ["qa:fe", "--", "--port", "63210"], frontendEnvironment(guard, text(origins[1])), ROOT);
        const frontendGroup = frontend.pid; demand(frontendGroup, "Missing owned frontend process");
        const recordedGroup = execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(frontendGroup)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
        demand(recordedGroup === String(frontendGroup), "Unexpected frontend group");
        writeFileSync(join(directory, "frontend-owner.json"), JSON.stringify({ runnerPid: process.pid, frontendPid: frontendGroup, frontendPgid: Number(recordedGroup) }), { flag: "wx", mode: 0o600 });
        await wait(() => listenerOwned(QA_PORTS[2], frontendGroup));
        console.log(`QA_READY syntheticJobs=6 groups=2/2/2 frontend=${FRONTEND} runDirectory=${directory}`);
        const readyAt = Date.now();
        if (serve) while (!stopping) {
            ensure();
            if (browser && !browserReady) browserReady = openQaBrowserGate(journal, readyAt, !unexpected && active.has(frontend));
            await Promise.race([sleep(100), stopRequested]);
        }
        demand(!unexpected, "Owned QA service exited unexpectedly");
    }, async () => {
        stopping = true;
        await cleanupQaRun(owners, active, launched, directory, journal, browserReady, () => {
            process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop); process.off("exit", emergency);
        });
    });
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const main = async () => {
        if (args[0] === "--backend" && args.length === 2 && /^[0-9a-f-]{36}$/.test(args[1] ?? "")) return startBackend(text(args[1]));
        const options = parseQaArguments(args);
        await run(options.serve, options.browser);
    };
    void main().catch((error: unknown) => {
        if (process.connected) process.send?.({ type: "failed", stage }, () => {});
        const status = (error as { qaHttpStatus?: unknown } | null)?.qaHttpStatus;
        console.error(`Document jobs QA failed at ${stage}${typeof status === "number" && Number.isInteger(status) ? ` HTTP ${status}` : ""}; details withheld`); process.exitCode = 1;
    });
}
