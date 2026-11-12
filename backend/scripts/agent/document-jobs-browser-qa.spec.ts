import fs from "node:fs";
import children from "node:child_process";
import { EventEmitter } from "node:events";
import { createOwnedChildren, reportQaFailure } from "./document-jobs-browser-qa.config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { frontendEnvironment, QA_SOCKET_GUARD, initializeQaJournal, verifyQaJournal, openQaBrowserGate, parseQaArguments, cleanupQaRun, withQaCleanup } from "./document-jobs-browser-qa";

const LSOF_PATH = process.platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof";

function withEnvironment(env: NodeJS.ProcessEnv, check: () => void): void {
    const original = process.env;
    try { process.env = { ...env }; check(); } finally { process.env = original; }
}

describe("document jobs frontend environment", () => {
    it("pins both upgrade controls and retains only allowed values despite hostile ambient settings", () => {
        withEnvironment({ PATH: "/qa/bin", HOME: "/qa/home", TMPDIR: "/qa/tmp", USER: "qa", LANG: "ko_KR.UTF-8",
            CI: "0", __NEXT_AGENT_UPGRADE: "latest", NEXT_TELEMETRY_DISABLED: "0", NODE_OPTIONS: "--require /hostile.cjs",
            NEXT_PUBLIC_API_BASE_URL: "https://unused.invalid", DATABASE_URL: "DUMMY", LOCAL_AUTO_LOGIN_PASSWORD: "DUMMY", UNRELATED_SECRET: "DUMMY" }, () => {
            expect(frontendEnvironment('/owned/guard "quoted".cjs', "http://127.0.0.1:3001")).toStrictEqual({
                PATH: "/opt/homebrew/opt/postgresql@16/bin:/qa/bin", HOME: "/qa/home", TMPDIR: "/qa/tmp", USER: "qa", LANG: "ko_KR.UTF-8",
                NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001", NEXT_TELEMETRY_DISABLED: "1",
                NODE_OPTIONS: '--require "/owned/guard \\"quoted\\".cjs"', CI: "1", __NEXT_AGENT_UPGRADE: "security",
            });
        });
    });

    it("omits empty base keys and uses the fixed fallback PATH", () => {
        withEnvironment({ PATH: "", HOME: "", TMPDIR: "", USER: "", LANG: "", UNRELATED_SECRET: "DUMMY" }, () => {
            expect(frontendEnvironment("/owned/guard.cjs", "http://localhost:3001")).toStrictEqual({
                PATH: "/opt/homebrew/opt/postgresql@16/bin:/usr/bin:/bin", NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001",
                NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: '--require "/owned/guard.cjs"', CI: "1", __NEXT_AGENT_UPGRADE: "security",
            });
        });
    });
});

let directory: string, journal: string, guard: string;
const roots: ChildProcess[] = [];
beforeEach(() => { directory = fs.mkdtempSync(join(tmpdir(), "bjj-ipc-test-")); journal = join(directory, "refusals.log"); guard = join(directory, "guard.cjs"); initializeQaJournal(journal); fs.writeFileSync(guard, QA_SOCKET_GUARD, { mode: 0o600 }); });
afterEach(async () => {
    for (const child of roots.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) {
            const row = execFileSync("/bin/ps", ["-o", "pid=,ppid=,pgid=", "-p", String(child.pid)], { encoding: "utf8", timeout: 2000 }).trim().split(/\s+/);
            expect(row).toEqual([String(child.pid), String(process.pid), String(child.pid)]);
            const exited = once(child, "exit"); child.send!({ stop: true }); await exited;
        }
        const deadline = Date.now() + 3000;
        while (true) { try { process.kill(-child.pid!, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; break; } if (Date.now() > deadline) throw new Error("Owned test group survived"); await new Promise(done => setTimeout(done, 20)); }
    }
    jest.restoreAllMocks(); jest.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true });
});
function guardHarness(change: (state: Record<string, unknown>) => void = () => {}) {
    const state: Record<string, unknown> = { marker: { runnerPid: 1, frontendPid: 10, frontendPgid: 10 }, metadata: { 30: "30 20 10", 20: "20 10 10", 10: "10 1 10", 1: "1 2 2" }, listeners: "p20\n", openFailure: false, partial: false };
    change(state); const delegate = jest.fn(), stderr: string[] = [];
    class FakeSocket { connect(...args: unknown[]) { delegate(...args); return this; } }
    const exec = jest.fn((file: string, args: string[], options: { timeout: number }) => {
        expect(options.timeout).toBe(2000);
        if (state["toolFailure"] === file) throw Object.assign(new Error("Tool failure"), { code: state["timeout"] ? "ETIMEDOUT" : "EIO" });
        if (file === "/bin/ps") return (state["metadata"] as Record<string, string>)[args[3]!] ?? "";
        expect(file).toBe(LSOF_PATH); expect(args).toEqual(["-nP", "-iTCP@127.0.0.1:45678", "-sTCP:LISTEN", "-Fp"]); return state["listeners"];
    });
    const fakeFs = { constants: fs.constants, readFileSync: () => { if (state["missing"]) throw new Error("Missing marker"); return state["rawMarker"] ?? JSON.stringify(state["marker"]); }, openSync: () => { if (state["openFailure"]) throw new Error("Append failed"); return 3; }, closeSync: jest.fn(), writeSync: (fd: number, line: string) => { if (fd === 2) stderr.push(line); return fd === 3 && state["partial"] ? 1 : line.length; } };
    runInNewContext(QA_SOCKET_GUARD, { __filename: "/private/guard.cjs", require: (name: string) => ({ "node:net": { Socket: FakeSocket }, "node:fs": fakeFs, "node:path": { dirname: () => "/private", join }, "node:child_process": { execFileSync: exec } })[name], process: { pid: 30, ppid: 20 } });
    return { connect: (host = "127.0.0.1", port = 45678) => new FakeSocket().connect({ host, port }), socket: () => new FakeSocket(), delegate, stderr, exec };
}
it("delegates once only for fresh parent/frontend/runner ownership", () => { const h = guardHarness(); h.connect(); expect(h.delegate).toHaveBeenCalledTimes(1); expect(h.stderr).toEqual([]); });
it("rejects hostname-only parent IPC under positive ownership without querying the OS", () => {
    const h = guardHarness(); expect(() => h.socket().connect({ hostname: "127.0.0.1", port: 45678 })).toThrow("QA unowned port refused");
    expect(h.delegate).not.toHaveBeenCalled(); expect(h.exec).not.toHaveBeenCalled(); expect(h.stderr).toEqual(["QA_SOCKET_REFUSED pid=30 port=45678\n"]);
});
it.each<[string, boolean]>([["localhost", true], ["127.0.0.1", true], ["external.invalid", false]])("preserves legacy fixed-port hostname alias %s", (hostname, allowed) => {
    const h = guardHarness(), connect = () => h.socket().connect({ hostname, port: 3001 });
    if (allowed) { connect(); expect(h.delegate).toHaveBeenCalledTimes(1); } else { expect(connect).toThrow(); expect(h.delegate).not.toHaveBeenCalled(); }
    expect(h.exec).not.toHaveBeenCalled();
});
it("preserves positional exact-host parent IPC", () => { const h = guardHarness(); h.socket().connect(45678, "127.0.0.1"); expect(h.delegate).toHaveBeenCalledTimes(1); });
it.each([
    ["missing marker", (s: Record<string, unknown>) => { s["missing"] = true; }], ["malformed marker", (s: Record<string, unknown>) => { s["rawMarker"] = "{"; }],
    ["invalid marker", (s: Record<string, unknown>) => { s["marker"] = { runnerPid: "1", frontendPid: 10, frontendPgid: 10 }; }],
    ...[30, 20, 10, 1].map(id => [`missing process ${id}`, (s: Record<string, unknown>) => { delete (s["metadata"] as Record<number, string>)[id]; }]),
    ...[[30, "30 99 10"], [30, "30 20 11"], [20, "20 10 11"], [10, "10 99 10"], [10, "10 1 11"], [1, "invalid"], [30, "3e1 20 10"], [20, "21 10 10"]].map(([id, row]) => [`wrong metadata ${id}/${row}`, (s: Record<string, unknown>) => { (s["metadata"] as Record<string, unknown>)[id!] = row; }]),
    ...["", "garbage", "p21\n", "p20\np21\n", "f7\n"].map(value => [`invalid listener ${value}`, (s: Record<string, unknown>) => { s["listeners"] = value; }]),
    ...["/bin/ps", LSOF_PATH].flatMap(file => [false, true].map(timeout => [`OS failure ${file}/${timeout}`, (s: Record<string, unknown>) => { s["toolFailure"] = file; s["timeout"] = timeout; }])),
    ["append error", (s: Record<string, unknown>) => { s["listeners"] = ""; s["openFailure"] = true; }], ["partial append", (s: Record<string, unknown>) => { s["listeners"] = ""; s["partial"] = true; }],
] as Array<[string, (state: Record<string, unknown>) => void]>)("refuses before delegation: %s", (_name, change) => { const h = guardHarness(change); expect(() => h.connect()).toThrow(); expect(h.delegate).not.toHaveBeenCalled(); expect(h.stderr).toEqual(["QA_SOCKET_REFUSED pid=30 port=45678\n"]); });
it.each([["localhost", 45678], ["::1", 45678], ["external.invalid", 45678], ["127.0.0.1", 443], ["external.invalid", 443], ["127.0.0.1", 1023], ["127.0.0.1", 65536]])("never delegates forbidden %s:%s", (host, port) => { const h = guardHarness(); expect(() => h.connect(host, port)).toThrow(); expect(h.delegate).not.toHaveBeenCalled(); expect(h.exec).not.toHaveBeenCalled(); });
it("preserves fixed/Unix/normalized forms without reading an owner", () => { const h = guardHarness(s => { s["missing"] = true; }); h.connect("localhost", 3001); h.connect("127.0.0.1", 62395); h.socket().connect(3001, "127.0.0.1"); h.socket().connect([{ port: 63210, host: "::1" }]); h.socket().connect({ path: "/owned/socket" }); h.socket().connect("/owned/socket"); expect(h.delegate).toHaveBeenCalledTimes(6); expect(h.exec).not.toHaveBeenCalled(); });
it("initializes an exclusive0600 journal and rejects missing/malformed/partial/read failures", () => {
    expect(fs.statSync(journal).mode & 0o777).toBe(0o600); expect(() => initializeQaJournal(journal)).toThrow(); expect(verifyQaJournal(journal)).toEqual([]);
    for (const text of ["bad\n", "QA_SOCKET_REFUSED pid=1 port=443", "QA_SOCKET_REFUSED pid=1 port=0\n", "QA_SOCKET_REFUSED pid=1 port=65536\n"]) { fs.writeFileSync(journal, text); expect(() => verifyQaJournal(journal, true)).toThrow(); }
    fs.unlinkSync(journal); expect(() => verifyQaJournal(journal)).toThrow();
    const read = jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("Read failed"); }); expect(() => verifyQaJournal(journal)).toThrow(); read.mockRestore();
});
it("enforces strict and post-browser journal policies with the actual synchronous phase gate", () => {
    jest.useFakeTimers(); jest.setSystemTime(0); const log = jest.spyOn(console, "log").mockImplementation(() => {});
    expect(openQaBrowserGate(journal, 0, true)).toBe(false); jest.setSystemTime(59999); expect(openQaBrowserGate(journal, 0, true)).toBe(false); expect(log).not.toHaveBeenCalled();
    jest.setSystemTime(60000); expect(() => openQaBrowserGate(journal, 0, false)).toThrow(); expect(log).not.toHaveBeenCalled();
    fs.writeFileSync(journal, "QA_SOCKET_REFUSED pid=7 port=443\n"); expect(() => openQaBrowserGate(journal, 0, true)).toThrow(); expect(log).not.toHaveBeenCalled(); expect(() => verifyQaJournal(journal)).toThrow();
    fs.writeFileSync(journal, ""); expect(openQaBrowserGate(journal, 0, true)).toBe(true); expect(log).toHaveBeenCalledWith("QA_BROWSER_READY"); expect(verifyQaJournal(journal, true)).toEqual([]);
    fs.writeFileSync(journal, "QA_SOCKET_REFUSED pid=7 port=443\n"); expect(verifyQaJournal(journal, true)).toEqual([{ pid: 7, port: 443 }]);
    fs.appendFileSync(journal, "QA_SOCKET_REFUSED pid=8 port=443\n"); expect(() => verifyQaJournal(journal, true)).toThrow(); fs.writeFileSync(journal, "QA_SOCKET_REFUSED pid=7 port=45678\n"); expect(() => verifyQaJournal(journal, true)).toThrow();
});
it("rejects browser qualification without serve before startup", () => { for (const args of [["--browser"], ["--check", "--browser"], ["--serve", "--serve"], []]) expect(() => parseQaArguments(args)).toThrow(); expect(parseQaArguments(["--serve", "--browser"])).toEqual({ serve: true, browser: true }); expect(parseQaArguments(["--check"])).toEqual({ serve: false, browser: false }); });
it("detects an unforwarded grandchild refusal and writes numeric stderr synchronously on uncaught exit", () => {
    const code = "require('net').connect({host:'external.invalid',port:443})", env = { ...process.env, NODE_OPTIONS: "", CHECKPOINT_DISABLE: "1", NEXT_TELEMETRY_DISABLED: "1" };
    const middle = spawnSync(process.execPath, ["-e", `const r=require('child_process').spawnSync(process.execPath,['--require',${JSON.stringify(guard)},'-e',${JSON.stringify(code)}],{stdio:'ignore'});process.exit(r.status===1?0:9)`], { env });
    expect(middle.status).toBe(0); expect(() => verifyQaJournal(journal)).toThrow("Unexpected QA socket refusal");
    const direct = spawnSync(process.execPath, ["--require", guard, "-e", code], { env, encoding: "utf8" }); expect(direct.status).toBe(1); expect(direct.stderr).toMatch(/^QA_SOCKET_REFUSED pid=\d+ port=443\n/);
});
const parentCode = `const net=require('net'),cp=require('child_process');let connections=0,sibling;const server=net.createServer(s=>{connections++;s.end()});
server.listen(0,'127.0.0.1',()=>{sibling=cp.spawn(process.execPath,['-e',"const n=require('net').createServer(s=>s.end());n.listen(0,'127.0.0.1',()=>process.send(n.address().port))"],{stdio:['ignore','ignore','ignore','ipc']});sibling.once('message',port=>process.send({port:server.address().port,sibling:port}));});
process.on('message',m=>{if(m.stop){const row=cp.execFileSync('/bin/ps',['-o','ppid=,pgid=','-p',String(sibling.pid)],{encoding:'utf8',timeout:2000}).trim().split(/\\s+/);if(row.join(',')!==process.pid+','+process.pid)throw Error('Owned sibling identity changed');sibling.once('exit',()=>server.close(()=>process.disconnect()));sibling.kill('SIGTERM');return;}let numeric='';const child=cp.spawn(process.execPath,['--require',m.guard,'-e',"require('net').connect({host:'127.0.0.1',port:"+m.port+"}).on('connect',function(){this.end()}).on('error',()=>process.exit(9))"],{stdio:['ignore','ignore','pipe']});child.stderr.on('data',part=>{for(const line of String(part).split('\\n'))if(/^QA_SOCKET_REFUSED pid=\\d+ port=\\d+$/.test(line))numeric+=line+'\\n';});child.once('close',code=>process.send({code,connections,numeric}));});`;
async function parent(): Promise<{ child: ChildProcess; port: number; sibling: number }> {
    const child = spawn(process.execPath, ["-e", parentCode], { detached: true, shell: false, env: { ...process.env, NODE_OPTIONS: "", CHECKPOINT_DISABLE: "1", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "ignore", "ignore", "ipc"] }); roots.push(child);
    const [message] = await once(child, "message"); return { child, ...(message as { port: number; sibling: number }) };
}
it.each(["parent", "sibling", "wrong-group"])("checks real owned OS listener identity: %s", async mode => {
    const front = await parent(), registered = mode === "wrong-group" ? await parent() : front;
    fs.writeFileSync(join(directory, "frontend-owner.json"), JSON.stringify({ runnerPid: process.pid, frontendPid: registered.child.pid, frontendPgid: registered.child.pid }), { flag: "wx", mode: 0o600 });
    const result = once(front.child, "message"), port = mode === "sibling" ? front.sibling : front.port; front.child.send!({ port, guard });
    const [message] = await result, actual = message as { code: number; connections: number; numeric: string };
    expect(actual.code).toBe(mode === "parent" ? 0 : 1); expect(actual.connections).toBe(mode === "parent" ? 1 : 0);
    if (mode === "parent") { expect(verifyQaJournal(journal)).toEqual([]); expect(actual.numeric).toBe(""); }
    else { expect(() => verifyQaJournal(journal)).toThrow("Unexpected QA socket refusal"); expect(actual.numeric).toMatch(new RegExp("^QA_SOCKET_REFUSED pid=\\d+ port=" + port + "\\n$")); }
}, 20000);


describe("safe cleanup diagnostics", () => {
    it("attributes exit-listener failure and preserves the original exception", () => {
        const child = Object.assign(new EventEmitter(), { pid: 1, exitCode: 0, signalCode: null }) as ChildProcess;
        jest.spyOn(children, "spawn").mockReturnValue(child);
        const failure = Object.assign(new Error("SECRET_MARKER"), { code: "EPERM" });
        jest.spyOn(process, "kill").mockImplementation(() => { throw failure; });
        const log = jest.spyOn(console, "error").mockImplementation(() => {});
        createOwnedChildren().spawn("unused", []);
        expect(() => child.emit("exit", 0)).toThrow(failure);
        expect(log.mock.calls).toEqual([[JSON.stringify({ operation: "exit-listener-signal", code: "EPERM", index: 0, signal: "SIGKILL", childState: "exited" })]]);
        expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET_MARKER");
    });
});


describe("cleanup attribution and policy preservation", () => {
    const failure = (code: string) => Object.assign(new Error("SECRET_MARKER"), { code, stack: "SECRET_MARKER", path: "/SECRET_MARKER", argv: "SECRET_MARKER", env: "SECRET_MARKER" });
    const child = () => Object.assign(new EventEmitter(), { pid: 1, exitCode: null, signalCode: null }) as ChildProcess;
    const cleanup = (launched: ChildProcess[] = [], active = new Set<ChildProcess>(), stop = jest.fn(), detach = jest.fn()) => cleanupQaRun({ stop } as unknown as ReturnType<typeof createOwnedChildren>, active, launched, directory, journal, false, detach);
    let log: jest.SpyInstance, stopped: jest.SpyInstance;
    const records = () => log.mock.calls.map(([line]: [string]) => JSON.parse(line) as Record<string, unknown>);
    beforeEach(() => { log = jest.spyOn(console, "error").mockImplementation(() => {}); stopped = jest.spyOn(console, "log").mockImplementation(() => {}); });
    afterEach(() => { expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET_MARKER"); });
    it("records both sibling failures and both journals, retaining the directory and rejection", async () => {
        const first = child(), second = child(), stop = jest.fn(() => { throw failure("EACCES"); });
        jest.spyOn(process, "kill").mockImplementation(() => { throw failure("EPERM"); });
        jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw failure("EIO"); });
        const detach = jest.fn();
        await expect(cleanup([first, second], new Set([second]), stop, detach)).rejects.toThrow("QA cleanup incomplete");
        expect(records()).toEqual([
            { operation: "journal-before", code: "EIO" },
            { operation: "group-signal", code: "EACCES", index: 1, signal: "SIGTERM", childState: "running" },
            { operation: "group-probe", code: "EPERM", index: 0, childState: "running" },
            { operation: "journal-after", code: "EIO" },
        ]);
        expect(stop).toHaveBeenCalledWith(second, "SIGTERM"); expect(detach).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(directory)).toBe(true); expect(stopped).not.toHaveBeenCalled();
    });
    it.each([() => "SECRET_MARKER", () => failure("SECRET_MARKER"), () => ({ get code() { throw new Error("SECRET_MARKER"); } })])("redacts unknown fields without replacing execution failure %#", async makeError => {
        const error = makeError();
        await expect(withQaCleanup(() => Promise.reject(error), () => Promise.resolve())).rejects.toBe(error);
        expect(records()).toEqual([{ operation: "execution", code: "UNKNOWN" }]);
    });
    it("keeps cleanup failure precedence while recording primary execution too", async () => {
        const primary = failure("EIO"), secondary = failure("EACCES");
        jest.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw secondary; });
        await expect(withQaCleanup(() => Promise.reject(primary), () => cleanup())).rejects.toBe(secondary);
        expect(records()).toEqual([{ operation: "execution", code: "EIO" }, { operation: "directory-remove", code: "EACCES" }]);
        expect(stopped).not.toHaveBeenCalled(); expect(fs.existsSync(directory)).toBe(true);
    });
    it("preserves last journal error, successful removal and QA_STOPPED ordering", async () => {
        const before = failure("ENOENT"), after = failure("EIO");
        jest.spyOn(fs, "readFileSync").mockImplementationOnce(() => { throw before; }).mockImplementationOnce(() => { throw after; });
        await expect(cleanup()).rejects.toBe(after);
        expect(records()).toEqual([{ operation: "journal-before", code: "ENOENT" }, { operation: "journal-after", code: "EIO" }]);
        expect(fs.existsSync(directory)).toBe(false); expect(stopped).toHaveBeenCalledWith("QA_STOPPED owned children exited; disposable directory removed");
    });
    it("bounds indices and never serializes hostile error fields", () => {
        reportQaFailure("execution", failure("EPERM"), Infinity);
        expect(records()).toEqual([{ operation: "execution", code: "EPERM" }]);
    });
    it.each([false, true])("exercises real socket-free owned cleanup, injected probe failure=%s", inject => {
        const code = `const {once}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createOwnedChildren}=require('./scripts/agent/document-jobs-browser-qa.config'),{cleanupQaRun,initializeQaJournal}=require('./scripts/agent/document-jobs-browser-qa');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bjj-cleanup-fixture-')),journal=path.join(dir,'journal');initializeQaJournal(journal);
const owners=createOwnedChildren(),child=owners.spawn(process.execPath,['-e','setTimeout(()=>{},2000)']),active=new Set([child]);child.once('exit',()=>active.delete(child));await once(child,'spawn');
const kill=process.kill;let failed=false;try{if(${inject})process.kill=function(pid,signal){if(pid===-child.pid&&signal===0)throw Object.assign(Error('probe'),{code:'EPERM'});return kill.call(process,pid,signal)};
if(${inject})active.delete(child);await cleanupQaRun(owners,active,[child],dir,journal,false,()=>{});
}catch{failed=true;if(!fs.existsSync(dir))throw Error('failure directory removed')}finally{process.kill=kill;if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');owners.stop(child);await exited}fs.rmSync(dir,{recursive:true,force:true})}
try{kill.call(process,-child.pid,0);throw Error('group survived')}catch(e){if(e.code!=='ESRCH')throw e}process.exitCode=failed?1:0})().catch(()=>{process.exitCode=9});`;
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", code], { cwd: join(__dirname, "../.."), env: { ...process.env, NODE_OPTIONS: "", CHECKPOINT_DISABLE: "1", NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8", timeout: 12000 });
        expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(inject ? 1 : 0);
        expect(result.stderr.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))).toEqual(inject ? [{ operation: "group-probe", code: "EPERM", index: 0, childState: "running" }] : []);
        expect(result.stdout.includes("QA_STOPPED")).toBe(!inject);
    }, 15000);
    it.each([false, true])("preserves actual exit callback process outcome, injected signal failure=%s", inject => {
        const code = `const {createOwnedChildren}=require('./scripts/agent/document-jobs-browser-qa.config');const owners=createOwnedChildren(),child=owners.spawn(process.execPath,['-e','setTimeout(()=>{},30)']);const kill=process.kill;
process.kill=function(pid,signal){if(${inject}&&pid===-child.pid&&signal==='SIGKILL')throw Object.assign(Error('fixture signal failure'),{code:'EPERM'});return kill.call(process,pid,signal)};`;
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", code], { cwd: join(__dirname, "../.."), env: { ...process.env, NODE_OPTIONS: "", CHECKPOINT_DISABLE: "1", NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8", timeout: 12000 });
        expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(inject ? 1 : 0);
        const lines = result.stderr.split("\n").filter(line => line.startsWith('{"operation":'));
        expect(lines.map(line => JSON.parse(line))).toEqual(inject ? [{ operation: "exit-listener-signal", code: "EPERM", index: 0, signal: "SIGKILL", childState: "exited" }] : []);
    }, 15000);
});
