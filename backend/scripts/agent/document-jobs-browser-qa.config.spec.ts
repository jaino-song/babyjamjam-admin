import children from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import {
    QA_DATABASE_URL, QA_PORTS, QA_IDENTITY_PATH, assertQaDatabase, backendOrigins,
    assertPortFree, assertQaPortsFree, verifyOwnedIdentity, verifyQaBackendIdentity, createOwnedChildren,
} from "./document-jobs-browser-qa.config";

const RUN_ID = "8f35b149-6617-40d4-94ea-89a182c57d4d";
const servers: Server[] = [];
const unowned: children.ChildProcess[] = [];
const owners = createOwnedChildren();
const portOf = (server: Server) => (server.address() as AddressInfo).port;
async function server(host: string, runId = RUN_ID, port = 0): Promise<Server> {
    const result = createServer((request, response) => {
        response.writeHead(request.url === QA_IDENTITY_PATH ? 200 : 404);
        response.end(JSON.stringify({ runId }));
    });
    servers.push(result);
    result.listen(port, host);
    await once(result, "listening");
    return result;
}
async function pair(secondIdentity = RUN_ID): Promise<Server[]> {
    const first = await server("127.0.0.1");
    return [first, await server("::1", secondIdentity, portOf(first))];
}
afterEach(async () => {
    jest.restoreAllMocks();
    owners.cleanup();
    await Promise.all(unowned.splice(0).map(child => new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", () => resolve()); child.kill();
    })));
    await Promise.all(servers.splice(0).map(value => new Promise<void>(resolve => {
        if (!value.listening) return resolve();
        value.close(() => resolve());
        value.closeAllConnections();
    })));
});

describe("document jobs disposable QA boundary", () => {
    it("pins the three ports and both database URLs", () => {
        expect(QA_PORTS).toEqual([62395, 3001, 63210]);
        expect(QA_DATABASE_URL).toBe("postgresql://bjj_document_jobs_test@127.0.0.1:62395/bjj_document_jobs_qa");
        expect(() => assertQaDatabase(QA_DATABASE_URL, QA_DATABASE_URL)).not.toThrow();
    });
    it.each([
        undefined, "", "postgresql://bjj_document_jobs_test@localhost:62395/bjj_document_jobs_qa",
        "postgresql://bjj_document_jobs_test@127.0.0.1:62295/bjj_document_jobs_qa",
        "postgresql://bjj_document_jobs_test@127.0.0.1:62395/shared",
        "postgresql://bjj_document_jobs_test@192.0.2.1:62395/bjj_document_jobs_qa",
    ])("refuses either wrong database input (%s)", value => {
        expect(() => assertQaDatabase(value, QA_DATABASE_URL)).toThrow();
        expect(() => assertQaDatabase(QA_DATABASE_URL, value)).toThrow();
    });
    it("reads both configured origins without normalizing localhost or modifying input", () => {
        const source = "DEVELOPMENT_API_BASE_URL=http://localhost:3001\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\n";
        expect(backendOrigins(source)).toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
        expect(source).toBe("DEVELOPMENT_API_BASE_URL=http://localhost:3001\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\n");
    });
    it.each(["\n", "\r\n", "\r"])("rejects a later dotenv colon override after %j", separator => {
        const source = ["DEVELOPMENT_API_BASE_URL=http://localhost:3001", "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001",
            "OTHER=unchanged", "NEXT_PUBLIC_API_BASE_URL: http://127.0.0.1:63101"].join(separator);
        expect(() => backendOrigins(source)).toThrow();
    });
    it.each(["\r\n", "\r"])("accepts canonical definitions separated by %j", separator => {
        expect(backendOrigins(["DEVELOPMENT_API_BASE_URL=http://localhost:3001", "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001"].join(separator)))
            .toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
    });
    it.each([
        "KEY=URL", " export KEY = 'URL' # quoted comment", '\tKEY\t=\t"URL"\t# comment', "KEY=URL#comment",
    ])("accepts canonical literal definitions: %s", format => {
        const source = ["# NEXT_PUBLIC_API_BASE_URL: ignored comment", 'OTHER="NEXT_PUBLIC_API_BASE_URL: text"',
            format.replace("URL", "http://localhost:3001").replace("KEY", "DEVELOPMENT_API_BASE_URL"),
            format.replace("URL", "http://127.0.0.1:3001").replace("KEY", "NEXT_PUBLIC_API_BASE_URL")].join("\n");
        expect(backendOrigins(source)).toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
    });
    it.each([
        "KEY: http://localhost:3001", "export KEY: http://localhost:3001", "KEY=`http://localhost:3001`",
        "KEY=${ORIGIN}", 'KEY="http://localhost:3001\\n"', "KEY='http://localhost:3001'junk",
        'KEY="http://localhost:3001\n"', "KEY=http://localhost:3001 trailing", 'KEY="http://localhost:3001\'',
        "KEY", "KEY=http://local\\host:3001",
    ])("refuses unsupported target definition: %s", definition => {
        for (const key of ["DEVELOPMENT_API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL"]) {
            const other = key === "DEVELOPMENT_API_BASE_URL" ? "NEXT_PUBLIC_API_BASE_URL" : "DEVELOPMENT_API_BASE_URL";
            expect(() => backendOrigins(`${definition.replace("KEY", key)}\n${other}=http://localhost:3001`)).toThrow();
        }
    });
    it.each(["DEVELOPMENT_API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL"])("refuses earlier or later allowed duplicates of %s", key => {
        const source = "DEVELOPMENT_API_BASE_URL=http://localhost:3001\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001";
        expect(() => backendOrigins(`${key}=http://localhost:3001\n${source}`)).toThrow();
        expect(() => backendOrigins(`${source}\nexport ${key}='http://localhost:3001' # still duplicate`)).toThrow();
    });
    it.each(["\u2028", "\u2029"])("rejects ambiguous Unicode line separator %j", separator => {
        const source = `DEVELOPMENT_API_BASE_URL=http://localhost:3001\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\nOTHER=unchanged${separator}NEXT_PUBLIC_API_BASE_URL: http://127.0.0.1:63101`;
        expect(() => backendOrigins(source)).toThrow();
    });
    it.each(["'", '"', "`"])("rejects unrelated multiline quoted assignments containing a fake target (%s)", quote => {
        const source = `DEVELOPMENT_API_BASE_URL=http://localhost:3001\nOTHER=${quote}unrelated\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\n${quote}`;
        expect(() => backendOrigins(source)).toThrow();
    });
    it.each(["OTHER: ", "export EX.TRA-KEY = "])("rejects ambiguous quoted blocks after %s", assignment => {
        expect(() => backendOrigins(`DEVELOPMENT_API_BASE_URL=http://localhost:3001\n${assignment}"text\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\n"`)).toThrow();
    });
    it.each(["\n", "\r\n", "\r"])("rejects cross-line assignment continuations with %j", separator => {
        const keys = ["DEVELOPMENT_API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL"];
        const origins = ["http://localhost:3001", "http://127.0.0.1:3001"];
        for (const hidden of [0, 1]) for (const quote of ["'", '"', "`"])
            for (const gap of [separator, ` ${separator}`, `\t${separator}`, `${separator} `, separator + separator])
                for (const left of ["OTHER=", "OTHER\n=", "export OTHER=", "OTHER:", "OTHER\n:", "export OTHER:"]) {
                    const other = 1 - hidden;
                    const source = `${keys[other]}=${origins[other]}${separator}${left.replace(/\n/g, separator)}${gap}${quote}text${separator}${keys[hidden]}=${origins[hidden]}${separator}${quote}`;
                    expect(() => backendOrigins(source)).toThrow();
                }
    });
    it.each(["STANDALONE", "=", ": ", "'text", '"', "`", "other value"])("refuses a non-assignment physical line %j", line => {
        expect(() => backendOrigins(`DEVELOPMENT_API_BASE_URL=http://localhost:3001\n${line}\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001`)).toThrow();
    });
    it("keeps ordinary empty, unquoted, quoted, dotted and colon assignments independent of the origins", () => {
        const source = ['OTHER=', 'EMPTY=""', 'export EXTRA = unquoted text # comment', "EX.TRA-KEY: literal", " # comment", "", "\t",
            "DEVELOPMENT_API_BASE_URL=http://localhost:3001", "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001"].join("\n");
        expect(backendOrigins(source)).toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
    });
    it("does not mistake an escaped quote before a comment for a closing quote", () => {
        expect(() => backendOrigins('DEVELOPMENT_API_BASE_URL=http://localhost:3001\nOTHER="text\\" # not closed\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\n"')).toThrow();
        expect(backendOrigins('OTHER="text\\" closed" # comment\nDEVELOPMENT_API_BASE_URL=http://localhost:3001\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001'))
            .toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
    });
    it.each(["'", '"', "`"].flatMap(quote => [0, 1, 2, 3, 4, 5, 6].flatMap(slashes =>
        [false, true].map(laterClose => [quote, slashes, laterClose] as const))))(
        "allows a quote after only zero backslashes (%s, %i, later close %s)", (quote, slashes, laterClose) => {
            const source = `DEVELOPMENT_API_BASE_URL=http://localhost:3001\nOTHER=${quote}text${"\\".repeat(slashes)}${quote} # comment\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001${laterClose ? `\nCLOSE=text${quote}` : ""}`;
            if (slashes === 0) expect(backendOrigins(source)).toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
            else expect(() => backendOrigins(source)).toThrow();
        },
    );
    it.each(["'", '"', "`"].flatMap(quote => ([
        [`a\\${quote}b${quote}`, true], [`a${"\\".repeat(2)}${quote}`, false],
        [`${"\\".repeat(4)}${quote}`, false], [quote, true], [`a${"\\".repeat(2)} ${quote}`, true],
    ] as const).flatMap(([body, allowed]) => [false, true].map(laterClose => [quote, body, allowed, laterClose] as const))))(
        "keeps the advised quoted-body boundary (%s, %s, allowed %s, later close %s)", (quote, body, allowed, laterClose) => {
            const source = `DEVELOPMENT_API_BASE_URL=http://localhost:3001\nOTHER=${quote}${body} # comment\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001${laterClose ? `\nCLOSE=text${quote}` : ""}`;
            if (allowed) expect(backendOrigins(source)).toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
            else expect(() => backendOrigins(source)).toThrow();
        },
    );
    it.each(["", "https://localhost:3001", "http://localhost:3001/", "http://localhost:3001/path",
        "http://localhost:3001?x=1", "http://localhost:3001#x", "http://user@localhost:3001",
        "http://[::1]:3001", "http://127.0.0.1:63101", "http://192.0.2.1:3001"]) (
        "rejects either unapproved configured origin (%s)", value => {
            for (const key of ["DEVELOPMENT_API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL"]) {
                const other = key === "DEVELOPMENT_API_BASE_URL" ? "NEXT_PUBLIC_API_BASE_URL" : "DEVELOPMENT_API_BASE_URL";
                expect(() => backendOrigins(`${key}="${value}"\n${other}=http://localhost:3001`)).toThrow();
            }
        },
    );
    it("rejects absent URL keys", () => {
        expect(() => backendOrigins("DEVELOPMENT_API_BASE_URL=http://localhost:3001")).toThrow();
    });
    it.each(["127.0.0.1", "::1", "::"])("detects an actual %s listener, then accepts its released port", async host => {
        const held = await server(host);
        const port = portOf(held);
        await expect(assertPortFree(port)).rejects.toThrow();
        await new Promise<void>(resolve => held.close(() => resolve()));
        await expect(assertPortFree(port)).resolves.toBeUndefined();
    });
    it("fails closed if listener inspection is unavailable", async () => {
        jest.spyOn(children, "execFileSync").mockImplementation(() => { throw Object.assign(new Error(), { code: "ENOENT" }); });
        await expect(assertPortFree(47399)).rejects.toThrow("inspect");
        await expect(assertQaPortsFree()).rejects.toThrow("inspect");
    });
    it.each(["127.0.0.1", "::1"])("also probes %s after lsof reports no listener", async host => {
        const held = await server(host);
        jest.spyOn(children, "execFileSync").mockImplementationOnce(() => { throw { status: 1, stdout: "", stderr: "" }; });
        await expect(assertPortFree(portOf(held))).rejects.toThrow("occupied");
    });
    it("checks all fixed ports in both families when free", async () => {
        const lsof = jest.spyOn(children, "execFileSync").mockImplementation(() => { throw { status: 1, stdout: "", stderr: "" }; });
        const connections = jest.spyOn(net, "connect").mockImplementation(() => {
            const socket = new net.Socket();
            queueMicrotask(() => socket.emit("error", Object.assign(new Error(), { code: "ECONNREFUSED" })));
            return socket;
        });
        await assertQaPortsFree();
        expect(lsof.mock.calls.map(call => call[1]?.[1])).toEqual(["-iTCP:62395", "-iTCP:3001", "-iTCP:63210"]);
        expect(connections.mock.calls.map(call => call[0])).toEqual([
            { host: "127.0.0.1", port: 62395 }, { host: "::1", port: 62395 },
            { host: "127.0.0.1", port: 3001 }, { host: "::1", port: 3001 },
            { host: "127.0.0.1", port: 63210 }, { host: "::1", port: 63210 },
        ]);
    });
    it.each([{ status: 1, stdout: "", stderr: "denied" }, { status: 2 }, { status: 1, stdout: "p1", stderr: "" }])(
        "rejects unverifiable lsof failures", async failure => {
            jest.spyOn(children, "execFileSync").mockImplementation(() => { throw failure; });
            await expect(assertPortFree(47399)).rejects.toThrow("inspect");
        },
    );
    it("verifies both owned listeners, explicit origins and configured localhost identity", async () => {
        const listeners = await pair();
        const origin = `http://localhost:${portOf(listeners[0]!)}`;
        await expect(verifyOwnedIdentity(listeners, [origin], RUN_ID)).resolves.toBeUndefined();
        await expect(verifyQaBackendIdentity(listeners, [origin], RUN_ID)).rejects.toThrow();
    });
    it("rejects one-family OTHER even if the IPv4 identity matches", async () => {
        const listeners = await pair("OTHER");
        await expect(verifyOwnedIdentity(listeners, [`http://127.0.0.1:${portOf(listeners[0]!)}`], RUN_ID)).rejects.toThrow();
    });
    it("rejects missing ownership, closed listeners, wrong port/origin and empty identity", async () => {
        const listeners = await pair();
        await expect(verifyOwnedIdentity(listeners.slice(0, 1), [], RUN_ID)).rejects.toThrow();
        await expect(verifyOwnedIdentity(listeners, ["http://192.0.2.1:3001"], RUN_ID)).rejects.toThrow();
        await expect(verifyOwnedIdentity(listeners, ["http://localhost:3001"], RUN_ID)).rejects.toThrow();
        await expect(verifyOwnedIdentity(listeners, [], "")).rejects.toThrow();
        await new Promise<void>(resolve => listeners[1]!.close(() => resolve()));
        await expect(verifyOwnedIdentity(listeners, [], RUN_ID)).rejects.toThrow();
    });
    it("cleans a partially started owned child while refusing an unregistered child", async () => {
        const owned = owners.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
        const other = children.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        unowned.push(other);
        await Promise.all([once(owned, "spawn"), once(other, "spawn")]);
        expect(() => owners.stop(other)).toThrow("owned");
        const exited = once(owned, "exit");
        owners.cleanup();
        await exited;
        expect(other.exitCode).toBeNull();
        expect(other.signalCode).toBeNull();
    });
    it("retains ownership for forced cleanup if SIGTERM is ignored", async () => {
        const child = owners.spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "ignore"] });
        if (!child.stdout) throw new Error("Missing owned test pipe");
        await once(child.stdout, "data"); owners.stop(child);
        const exited = once(child, "exit"); owners.stop(child, "SIGKILL");
        await exited;
        expect(child.signalCode).toBe("SIGKILL");
    });
    it("stops the owned descendant listener when its parent exits", async () => {
        const descendant = "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)))";
        const parent = owners.spawn(process.execPath, ["-e", `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',d=>process.stdout.write(d,()=>process.exit(0)))`], { stdio: ["ignore", "pipe", "ignore"] });
        const exited = once(parent, "exit"); if (!parent.stdout) throw new Error("Missing owned test pipe");
        try { const [message] = await once(parent.stdout, "data"); await exited;
            for (let attempt = 0; ; attempt++) { try { await assertPortFree(Number(String(message))); break; } catch (error) { if (attempt === 19) throw error; await new Promise(resolve => setTimeout(resolve, 10)); } }
        } finally { if (parent.pid) { try { process.kill(-parent.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } } }
    });
});
