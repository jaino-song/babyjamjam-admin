import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import type { Harness } from "./runner-support";

const BACKEND_DIR = path.resolve(__dirname, "../../../../..");
const HELPER = "test/infrastructure/eformsign-backup/worker/helpers/runner-cli-helper.ts";
export interface Spawned { child: ChildProcess; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; stdout: () => string; stderr: () => string }

/** `flock -n -F -E 75 <lock> node ...`: with -F the node process itself holds the lock, as in the systemd form (contract W3). */
export function spawnUnderFlock(h: Harness, args: string[], options: { flock?: boolean } = {}): Spawned {
    const node = [process.execPath, "-r", "ts-node/register/transpile-only", HELPER, ...args];
    const command = options.flock === false ? node : ["flock", "-n", "-F", "-E", "75", h.lockPath, ...node];
    const child = spawn(command[0]!, command.slice(1), { cwd: BACKEND_DIR, env: { ...process.env, NODE_PATH: "." }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout!.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr!.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return { child, exited, stdout: () => out, stderr: () => err };
}

